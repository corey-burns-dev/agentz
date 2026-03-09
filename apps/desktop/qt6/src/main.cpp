// Agents Qt6 shell: hosts the web app in QWebEngineView and connects to the same server as Tauri.

#include <QApplication>
#include <QDir>
#include <QFileInfo>
#include <QHostAddress>
#include <QMainWindow>
#include <QMessageBox>
#include <QProcess>
#include <QStandardPaths>
#include <QTcpServer>
#include <QUrl>
#include <QWebEngineProfile>
#include <QWebEngineScript>
#include <QWebEngineScriptCollection>
#include <QWebEngineView>
#include <cstdlib>
#include <memory>
#include <random>

namespace {

QString env(const char* name, const char* fallback = "") {
    const QByteArray v = qgetenv(name);
    return v.isEmpty() ? QString::fromUtf8(fallback) : QString::fromUtf8(v);
}

// Escape string for use inside a JavaScript single-quoted string.
QString escapeJs(QString s) {
    return s.replace(QChar('\\'), "\\\\")
            .replace(QChar('\''), "\\'")
            .replace(QChar('\n'), "\\n")
            .replace(QChar('\r'), "\\r");
}

// Stub DesktopBridge: getWsUrl returns the real URL; other methods are no-ops so the web app doesn't break.
QString desktopBridgeScript(const QString& wsUrl) {
    const QString escaped = escapeJs(wsUrl);
    return QStringLiteral(
        "(function(){"
        "var u = '%1';"
        "window.desktopBridge = {"
        "  getWsUrl: function() { return u || null; },"
        "  pickFolder: function() { return Promise.resolve(null); },"
        "  listChildDirectories: function() { return Promise.resolve([]); },"
        "  confirm: function() { return Promise.resolve(false); },"
        "  showContextMenu: function() { return Promise.resolve(null); },"
        "  openExternal: function() { return Promise.resolve(false); },"
        "  onMenuAction: function() { return function() {}; },"
        "  getUpdateState: function() { return Promise.resolve({ enabled: false, status: '', current_version: '', can_retry: false }); },"
        "  downloadUpdate: function() { return Promise.resolve({ accepted: false, completed: false, state: {} }); },"
        "  installUpdate: function() { return Promise.resolve({ accepted: false, completed: false, state: {} }); },"
        "  onUpdateState: function() { return function() {}; }"
        "};"
        "})();"
    ).arg(escaped);
}

// Reserve a port by binding to 0.
quint16 reservePort() {
    QTcpServer s;
    if (!s.listen(QHostAddress::LocalHost, 0))
        return 0;
    quint16 port = s.serverPort();
    s.close();
    return port;
}

QString generateToken() {
    static const char hex[] = "0123456789abcdef";
    std::random_device rd;
    std::uniform_int_distribution<int> dist(0, 15);
    QString t;
    for (int i = 0; i < 48; ++i)
        t += QChar(hex[dist(rd) & 15]);
    return t;
}

QString findNodeOrBun() {
    QString override = env("AGENTS_DESKTOP_NODE");
    if (!override.isEmpty())
        return override;
    QProcess p;
    p.setProgram("bun");
    p.setArguments({ "--version" });
    p.start();
    if (p.waitForFinished(2000) && p.exitStatus() == QProcess::NormalExit)
        return QString("bun");
    return QString("node");
}

// Walk up from executable to find apps/server/dist/index.mjs; return (entryPath, cwd).
std::pair<QString, QString> findServerEntry() {
    QFileInfo fi(QCoreApplication::applicationFilePath());
    QDir dir = fi.absoluteDir();
    for (int i = 0; i < 20; ++i) {
        QString appsServer = dir.absoluteFilePath("apps/server/dist/index.mjs");
        if (QFileInfo::exists(appsServer))
            return { appsServer, dir.absolutePath() };
        QString serverDist = dir.absoluteFilePath("server/dist/index.mjs");
        if (QFileInfo::exists(serverDist))
            return { serverDist, dir.absolutePath() };
        if (!dir.cdUp())
            break;
    }
    return {};
}

} // namespace

struct ServerProcess {
    QProcess process;
    QString wsUrl;
    QString clientBaseUrl;
};

int main(int argc, char* argv[]) {
    QApplication app(argc, argv);
    app.setApplicationName("Agents (Alpha)");

    QString wsUrl;
    QUrl loadUrl;
    std::unique_ptr<ServerProcess> serverProcess;
    QWebEngineProfile* profile = new QWebEngineProfile("agents", &app);

    if (!env("AGENTS_DESKTOP_WS_URL").isEmpty()) {
        // Dev: server and URL provided by dev-runner.
        wsUrl = env("AGENTS_DESKTOP_WS_URL");
        QString devUrl = env("VITE_DEV_SERVER_URL", "http://localhost:5733");
        loadUrl = QUrl(devUrl);
    } else {
        // Production: spawn server, then load built client.
        auto [serverEntry, cwd] = findServerEntry();
        if (serverEntry.isEmpty()) {
            QMessageBox::critical(nullptr, "Agents", "Server entry index.mjs not found.");
            return 1;
        }
        quint16 port = reservePort();
        if (port == 0) {
            QMessageBox::critical(nullptr, "Agents", "Could not reserve a port.");
            return 1;
        }
        QString token = generateToken();
        wsUrl = QString("ws://127.0.0.1:%1/?token=%2").arg(port).arg(token);
        QString stateDir = env("AGENTS_STATE_DIR");
        if (stateDir.isEmpty())
            stateDir = QStandardPaths::writableLocation(QStandardPaths::HomeLocation) + "/.agents/userdata";

        serverProcess = std::make_unique<ServerProcess>();
        serverProcess->wsUrl = wsUrl;
        QProcessEnvironment env = QProcessEnvironment::systemEnvironment();
        env.insert("AGENTS_MODE", "desktop");
        env.insert("AGENTS_NO_BROWSER", "1");
        env.insert("AGENTS_PORT", QString::number(port));
        env.insert("AGENTS_STATE_DIR", stateDir);
        env.insert("AGENTS_AUTH_TOKEN", token);
        serverProcess->process.setProcessEnvironment(env);
        serverProcess->process.setWorkingDirectory(cwd);
        serverProcess->process.setProgram(findNodeOrBun());
        serverProcess->process.setArguments({ serverEntry });
        serverProcess->process.start();
        if (!serverProcess->process.waitForStarted(5000)) {
            QMessageBox::critical(nullptr, "Agents", "Failed to start server process.");
            return 1;
        }

        // Client is next to server: .../apps/server/dist/client/index.html
        QFileInfo serverFi(serverEntry);
        QDir serverDir = serverFi.absoluteDir();
        QString clientIndex = serverDir.absoluteFilePath("client/index.html");
        if (!QFileInfo::exists(clientIndex)) {
            QMessageBox::critical(nullptr, "Agents", "Client index.html not found.");
            return 1;
        }
        loadUrl = QUrl::fromLocalFile(clientIndex);
    }

    // Inject desktopBridge before any page script runs.
    QWebEngineScript script;
    script.setName("desktopBridge");
    script.setSourceCode(desktopBridgeScript(wsUrl));
    script.setInjectionPoint(QWebEngineScript::DocumentCreation);
    script.setWorldId(QWebEngineScript::MainWorld);
    script.setRunsOnSubFrames(false);
    profile->scripts()->insert(script);

    QMainWindow win;
    win.setWindowTitle("Agents (Alpha)");
    win.resize(1100, 780);
    win.setMinimumSize(840, 620);

    QWebEngineView* view = new QWebEngineView(profile, &win);
    win.setCentralWidget(view);
    view->setUrl(loadUrl);
    win.show();

    QObject::connect(&app, &QCoreApplication::aboutToQuit, [&]() {
        if (serverProcess && serverProcess->process.state() != QProcess::NotRunning)
            serverProcess->process.terminate();
    });

    return app.exec();
}
