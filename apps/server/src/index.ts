import { NetService } from "@agentz/shared/Net";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Command } from "effect/unstable/cli";
import { FetchHttpClient } from "effect/unstable/http";
import { version } from "../package.json" with { type: "json" };
import { agentzCli, CliConfig } from "./main";
import { OpenLive } from "./open";
import { ServerLive } from "./wsServer";

const RuntimeLayer = Layer.empty.pipe(
	Layer.provideMerge(CliConfig.layer),
	Layer.provideMerge(ServerLive),
	Layer.provideMerge(OpenLive),
	Layer.provideMerge(NetService.layer),
	Layer.provideMerge(NodeServices.layer),
	Layer.provideMerge(FetchHttpClient.layer),
);

Command.run(agentzCli, { version }).pipe(
	Effect.provide(RuntimeLayer),
	NodeRuntime.runMain,
);
