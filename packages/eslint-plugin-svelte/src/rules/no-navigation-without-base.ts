import type { TSESTree } from '@typescript-eslint/types';
import { createRule } from '../utils/index.js';
import { ReferenceTracker } from '@eslint-community/eslint-utils';
import { getSourceCode } from '../utils/compat.js';
import { findVariable } from '../utils/ast-utils.js';
import { extractExpressionPrefixVariable } from '../utils/expression-affixes.js';
import type { RuleContext } from '../types.js';
import type { SvelteLiteral } from 'svelte-eslint-parser/lib/ast';

export default createRule('no-navigation-without-base', {
	meta: {
		docs: {
			description:
				'disallow using navigation (links, goto, pushState, replaceState) without the base path',
			category: 'SvelteKit',
			recommended: false
		},
		schema: [
			{
				type: 'object',
				properties: {
					ignoreGoto: {
						type: 'boolean'
					},
					ignoreLinks: {
						type: 'boolean'
					},
					ignorePushState: {
						type: 'boolean'
					},
					ignoreReplaceState: {
						type: 'boolean'
					}
				},
				additionalProperties: false
			}
		],
		messages: {
			gotoNotPrefixed: "Found a goto() call with a url that isn't prefixed with the base path.",
			linkNotPrefixed: "Found a link with a url that isn't prefixed with the base path.",
			pushStateNotPrefixed:
				"Found a pushState() call with a url that isn't prefixed with the base path.",
			replaceStateNotPrefixed:
				"Found a replaceState() call with a url that isn't prefixed with the base path."
		},
		type: 'suggestion'
	},
	create(context) {
		let basePathNames: Set<TSESTree.Identifier> = new Set<TSESTree.Identifier>();
		return {
			Program() {
				const referenceTracker = new ReferenceTracker(
					getSourceCode(context).scopeManager.globalScope!
				);
				basePathNames = extractBasePathReferences(referenceTracker, context);
				const {
					goto: gotoCalls,
					pushState: pushStateCalls,
					replaceState: replaceStateCalls
				} = extractFunctionCallReferences(referenceTracker);
				if (context.options[0]?.ignoreGoto !== true) {
					for (const gotoCall of gotoCalls) {
						checkGotoCall(context, gotoCall, basePathNames);
					}
				}
				if (context.options[0]?.ignorePushState !== true) {
					for (const pushStateCall of pushStateCalls) {
						checkShallowNavigationCall(
							context,
							pushStateCall,
							basePathNames,
							'pushStateNotPrefixed'
						);
					}
				}
				if (context.options[0]?.ignoreReplaceState !== true) {
					for (const replaceStateCall of replaceStateCalls) {
						checkShallowNavigationCall(
							context,
							replaceStateCall,
							basePathNames,
							'replaceStateNotPrefixed'
						);
					}
				}
			},
			SvelteAttribute(node) {
				if (
					context.options[0]?.ignoreLinks === true ||
					node.parent.parent.type !== 'SvelteElement' ||
					node.parent.parent.kind !== 'html' ||
					node.parent.parent.name.type !== 'SvelteName' ||
					node.parent.parent.name.name !== 'a' ||
					node.key.name !== 'href'
				) {
					return;
				}
				const hrefValue = node.value[0];
				if (hrefValue.type === 'SvelteLiteral') {
					if (!expressionIsAbsolute(hrefValue) && !expressionIsFragment(hrefValue)) {
						context.report({ loc: hrefValue.loc, messageId: 'linkNotPrefixed' });
					}
					return;
				}
				if (
					!expressionStartsWithBase(context, hrefValue.expression, basePathNames) &&
					!expressionIsAbsolute(hrefValue.expression) &&
					!expressionIsFragment(hrefValue.expression)
				) {
					context.report({ loc: hrefValue.loc, messageId: 'linkNotPrefixed' });
				}
			}
		};
	}
});

// Extract all imports of the base path

function extractBasePathReferences(
	referenceTracker: ReferenceTracker,
	context: RuleContext
): Set<TSESTree.Identifier> {
	const set = new Set<TSESTree.Identifier>();
	for (const { node } of referenceTracker.iterateEsmReferences({
		'$app/paths': {
			[ReferenceTracker.ESM]: true,
			base: {
				[ReferenceTracker.READ]: true
			}
		}
	})) {
		if (node.type === 'ImportSpecifier') {
			const variable = findVariable(context, node.local);
			if (variable === null) {
				continue;
			}
			for (const reference of variable.references) {
				if (reference.identifier.type === 'Identifier') set.add(reference.identifier);
			}
		} else if (
			node.type === 'MemberExpression' &&
			node.property.type === 'Identifier' &&
			node.property.name === 'base'
		) {
			set.add(node.property);
		}
	}
	return set;
}

// Extract all references to goto, pushState and replaceState

function extractFunctionCallReferences(referenceTracker: ReferenceTracker): {
	goto: TSESTree.CallExpression[];
	pushState: TSESTree.CallExpression[];
	replaceState: TSESTree.CallExpression[];
} {
	const rawReferences = Array.from(
		referenceTracker.iterateEsmReferences({
			'$app/navigation': {
				[ReferenceTracker.ESM]: true,
				goto: {
					[ReferenceTracker.CALL]: true
				},
				pushState: {
					[ReferenceTracker.CALL]: true
				},
				replaceState: {
					[ReferenceTracker.CALL]: true
				}
			}
		})
	);
	return {
		goto: rawReferences
			.filter(({ path }) => path[path.length - 1] === 'goto')
			.map(({ node }) => node),
		pushState: rawReferences
			.filter(({ path }) => path[path.length - 1] === 'pushState')
			.map(({ node }) => node),
		replaceState: rawReferences
			.filter(({ path }) => path[path.length - 1] === 'replaceState')
			.map(({ node }) => node)
	};
}

// Actual function checking

function checkGotoCall(
	context: RuleContext,
	call: TSESTree.CallExpression,
	basePathNames: Set<TSESTree.Identifier>
): void {
	if (call.arguments.length < 1) {
		return;
	}
	const url = call.arguments[0];
	if (url.type === 'SpreadElement' || !expressionStartsWithBase(context, url, basePathNames)) {
		context.report({ loc: url.loc, messageId: 'gotoNotPrefixed' });
	}
}

function checkShallowNavigationCall(
	context: RuleContext,
	call: TSESTree.CallExpression,
	basePathNames: Set<TSESTree.Identifier>,
	messageId: string
): void {
	if (call.arguments.length < 1) {
		return;
	}
	const url = call.arguments[0];
	if (
		url.type === 'SpreadElement' ||
		(!expressionIsEmpty(url) && !expressionStartsWithBase(context, url, basePathNames))
	) {
		context.report({ loc: url.loc, messageId });
	}
}

// Helper functions

function expressionStartsWithBase(
	context: RuleContext,
	url: TSESTree.Expression,
	basePathNames: Set<TSESTree.Identifier>
): boolean {
	const prefixVariable = extractExpressionPrefixVariable(context, url);
	return prefixVariable !== null && basePathNames.has(prefixVariable);
}

function expressionIsEmpty(url: TSESTree.Expression): boolean {
	return (
		(url.type === 'Literal' && url.value === '') ||
		(url.type === 'TemplateLiteral' &&
			url.expressions.length === 0 &&
			url.quasis.length === 1 &&
			url.quasis[0].value.raw === '')
	);
}

function expressionIsAbsolute(url: SvelteLiteral | TSESTree.Expression): boolean {
	switch (url.type) {
		case 'BinaryExpression':
			return binaryExpressionIsAbsolute(url);
		case 'Literal':
			return typeof url.value === 'string' && urlValueIsAbsolute(url.value);
		case 'SvelteLiteral':
			return urlValueIsAbsolute(url.value);
		case 'TemplateLiteral':
			return templateLiteralIsAbsolute(url);
		default:
			return false;
	}
}

function binaryExpressionIsAbsolute(url: TSESTree.BinaryExpression): boolean {
	return (
		(url.left.type !== 'PrivateIdentifier' && expressionIsAbsolute(url.left)) ||
		expressionIsAbsolute(url.right)
	);
}

function templateLiteralIsAbsolute(url: TSESTree.TemplateLiteral): boolean {
	return (
		url.expressions.some(expressionIsAbsolute) ||
		url.quasis.some((quasi) => urlValueIsAbsolute(quasi.value.raw))
	);
}

function urlValueIsAbsolute(url: string): boolean {
	return url.includes('://');
}

function expressionIsFragment(url: SvelteLiteral | TSESTree.Expression): boolean {
	switch (url.type) {
		case 'BinaryExpression':
			return binaryExpressionIsFragment(url);
		case 'Literal':
			return typeof url.value === 'string' && urlValueIsFragment(url.value);
		case 'SvelteLiteral':
			return urlValueIsFragment(url.value);
		case 'TemplateLiteral':
			return templateLiteralIsFragment(url);
		default:
			return false;
	}
}

function binaryExpressionIsFragment(url: TSESTree.BinaryExpression): boolean {
	return url.left.type !== 'PrivateIdentifier' && expressionIsFragment(url.left);
}

function templateLiteralIsFragment(url: TSESTree.TemplateLiteral): boolean {
	return (
		(url.expressions.length >= 1 && expressionIsFragment(url.expressions[0])) ||
		(url.quasis.length >= 1 && urlValueIsFragment(url.quasis[0].value.raw))
	);
}

function urlValueIsFragment(url: string): boolean {
	return url.startsWith('#');
}
