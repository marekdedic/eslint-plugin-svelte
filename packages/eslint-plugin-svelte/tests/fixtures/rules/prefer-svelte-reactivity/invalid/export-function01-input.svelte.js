const fn1 = () => {
	return new Set([1, 2, 1, 3, 3]);
}

function fn2() {
	return new Set([1, 2, 1, 3, 3]);
}

function fn3() {
	return new Set([1, 2, 1, 3, 3]);
}

export {fn1, fn2, fn3 as fn};

export const fn4 = () => {
	return new Set([1, 2, 1, 3, 3]);
}

export function fn5() {
	return new Set([1, 2, 1, 3, 3]);
}
