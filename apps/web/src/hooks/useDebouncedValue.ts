import { useEffect, useRef, useState } from "react";

/**
 * Debounces a value by `ms` milliseconds.
 * Returns the debounced value and a state object with `isPending` indicating
 * whether a deferred update is in flight.
 */
export function useDebouncedValue<T>(
	value: T,
	ms: number,
): [T, { state: { isPending: boolean } }] {
	const [debouncedValue, setDebouncedValue] = useState(value);
	const [isPending, setIsPending] = useState(false);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		setIsPending(true);
		timerRef.current = setTimeout(() => {
			setDebouncedValue(value);
			setIsPending(false);
		}, ms);
		return () => {
			if (timerRef.current) clearTimeout(timerRef.current);
		};
	}, [value, ms]);

	return [debouncedValue, { state: { isPending } }];
}
