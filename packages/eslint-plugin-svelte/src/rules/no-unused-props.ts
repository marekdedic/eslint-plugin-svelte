import { createRule } from '../utils/index.js';
import { getTypeScriptTools } from '../utils/ts-utils/index.js';
import type { TSESTree } from '@typescript-eslint/types';
import type ts from 'typescript';
import { findVariable } from '../utils/ast-utils.js';
import { toRegExp } from '../utils/regexp.js';
import { getFilename } from '../utils/compat.js';

type PropertyPath = string[];

let isRemovedWarningShown = false;

export default createRule('no-unused-props', {
	meta: {
		docs: {
			description: 'Warns about defined Props properties that are unused',
			category: 'Best Practices',
			recommended: true
		},
		schema: [
			{
				type: 'object',
				properties: {
					checkImportedTypes: {
						type: 'boolean',
						default: false
					},
					ignoreTypePatterns: {
						type: 'array',
						items: {
							type: 'string'
						},
						default: []
					},
					ignorePropertyPatterns: {
						type: 'array',
						items: {
							type: 'string'
						},
						default: []
					}
				},
				additionalProperties: false
			}
		],
		messages: {
			unusedProp: "'{{name}}' is an unused Props property.",
			unusedNestedProp: "'{{name}}' in '{{parent}}' is an unused property.",
			unusedIndexSignature:
				'Index signature is unused. Consider using rest operator (...) to capture remaining properties.'
		},
		type: 'suggestion',
		conditions: [
			{
				svelteVersions: ['5'],
				runes: [true, 'undetermined']
			}
		]
	},
	create(context) {
		const fileName = getFilename(context);
		const tools = getTypeScriptTools(context);
		if (!tools) {
			return {};
		}

		const typeChecker = tools.service.program.getTypeChecker();
		if (!typeChecker) {
			return {};
		}

		const options = context.options[0] ?? {};

		// TODO: Remove in v4
		// MEMO: `ignorePatterns` was a property that only existed from v3.2.0 to v3.2.2.
		// From v3.3.0, it was replaced with `ignorePropertyPatterns` and `ignoreTypePatterns`.
		if (options.ignorePatterns != null && !isRemovedWarningShown) {
			console.warn(
				'eslint-plugin-svelte: The `ignorePatterns` option in the `no-unused-props` rule has been removed. Please use `ignorePropertyPatterns` or/and `ignoreTypePatterns` instead.'
			);
			isRemovedWarningShown = true;
		}

		const checkImportedTypes = options.checkImportedTypes ?? false;

		const ignoreTypePatterns = (options.ignoreTypePatterns ?? []).map((p: string | RegExp) => {
			if (typeof p === 'string') {
				return toRegExp(p);
			}
			return p;
		});

		const ignorePropertyPatterns = (options.ignorePropertyPatterns ?? []).map(
			(p: string | RegExp) => {
				if (typeof p === 'string') {
					return toRegExp(p);
				}
				return p;
			}
		);

		function shouldIgnoreProperty(name: string): boolean {
			return ignorePropertyPatterns.some((pattern: RegExp) => pattern.test(name));
		}

		function shouldIgnoreType(type: ts.Type): boolean {
			function isMatched(name: string): boolean {
				return ignoreTypePatterns.some((pattern: RegExp) => pattern.test(name));
			}

			const typeStr = typeChecker.typeToString(type);
			const symbol = type.getSymbol();
			const symbolName = symbol?.getName();
			return isMatched(typeStr) || (symbolName ? isMatched(symbolName) : false);
		}

		function isInternalProperty(symbol: ts.Symbol): boolean {
			const declarations = symbol.getDeclarations();
			if (!declarations || declarations.length === 0) return false;

			return declarations.every((decl) => decl.getSourceFile().fileName === fileName);
		}

		/**
		 * Extracts property paths from member expressions.
		 */
		function getPropertyPath(node: TSESTree.Identifier): PropertyPath {
			const paths: PropertyPath = [];
			let currentNode: TSESTree.Node = node;
			let parentNode: TSESTree.Node | null = currentNode.parent ?? null;

			while (parentNode) {
				if (parentNode.type === 'MemberExpression' && parentNode.object === currentNode) {
					const property = parentNode.property;
					if (property.type === 'Identifier') {
						paths.push(property.name);
					} else if (property.type === 'Literal' && typeof property.value === 'string') {
						paths.push(property.value);
					} else {
						break;
					}
				}
				currentNode = parentNode;
				parentNode = currentNode.parent ?? null;
			}

			return paths;
		}

		/**
		 * Finds all property access paths for a given variable.
		 */
		function getUsedNestedPropertyNames(node: TSESTree.Identifier): PropertyPath[] {
			const variable = findVariable(context, node);
			if (!variable) return [];

			const paths: PropertyPath[] = [];
			for (const reference of variable.references) {
				if (
					'identifier' in reference &&
					reference.identifier.type === 'Identifier' &&
					(reference.identifier.range[0] !== node.range[0] ||
						reference.identifier.range[1] !== node.range[1])
				) {
					const referencePath = getPropertyPath(reference.identifier);
					paths.push(referencePath);
				}
			}
			return paths;
		}

		/**
		 * Checks if a property is from TypeScript's built-in type definitions.
		 * These properties should be ignored as they are not user-defined props.
		 */
		function isBuiltInProperty(prop: ts.Symbol): boolean {
			const declarations = prop.getDeclarations();
			if (!declarations || declarations.length === 0) return false;

			const declaration = declarations[0];
			const sourceFile = declaration.getSourceFile();
			if (!sourceFile) return false;
			return sourceFile.fileName.includes('node_modules/typescript/lib/');
		}

		function getUsedPropertiesFromPattern(pattern: TSESTree.ObjectPattern): Set<string> {
			const usedProps = new Set<string>();
			for (const prop of pattern.properties) {
				if (prop.type === 'Property' && prop.key.type === 'Identifier') {
					usedProps.add(prop.key.name);
				} else if (prop.type === 'RestElement') {
					// If there's a rest element, all properties are potentially used
					return new Set();
				}
			}
			return usedProps;
		}

		/**
		 * Check if the type is a class type (has constructor or prototype)
		 */
		function isClassType(type: ts.Type): boolean {
			if (!type) return false;

			// Check if it's a class instance type
			if (type.isClass()) return true;

			// Check for constructor signatures
			const constructorType = type.getConstructSignatures();
			if (constructorType.length > 0) return true;

			// Check if it has a prototype property
			const symbol = type.getSymbol();
			if (symbol?.members?.has('prototype' as ts.__String)) return true;

			return false;
		}

		/**
		 * Recursively checks for unused properties in a type.
		 */
		function checkUnusedProperties(
			type: ts.Type,
			usedPaths: PropertyPath[],
			usedProps: Set<string>,
			reportNode: TSESTree.Node,
			parentPath: string[],
			checkedTypes: Set<string>,
			reportedProps: Set<string>
		) {
			// Skip checking if the type itself is a class
			if (isClassType(type)) return;

			const typeStr = typeChecker.typeToString(type);
			if (checkedTypes.has(typeStr)) return;
			checkedTypes.add(typeStr);
			if (shouldIgnoreType(type)) return;

			const properties = typeChecker.getPropertiesOfType(type);
			const baseTypes = type.getBaseTypes();

			if (!properties.length && (!baseTypes || baseTypes.length === 0)) {
				return;
			}

			if (baseTypes) {
				for (const baseType of baseTypes) {
					checkUnusedProperties(
						baseType,
						usedPaths,
						usedProps,
						reportNode,
						parentPath,
						checkedTypes,
						reportedProps
					);
				}
			}

			for (const prop of properties) {
				if (isBuiltInProperty(prop)) continue;
				if (!checkImportedTypes && !isInternalProperty(prop)) continue;

				const propName = prop.getName();
				if (shouldIgnoreProperty(propName)) continue;

				const currentPath = [...parentPath, propName];
				const currentPathStr = [...parentPath, propName].join('.');

				if (reportedProps.has(currentPathStr)) continue;

				const propType = typeChecker.getTypeOfSymbol(prop);

				const joinedUsedPaths = usedPaths.map((path) => path.join('.'));
				const isUsedThisInPath = joinedUsedPaths.includes(currentPathStr);
				const isUsedInPath = joinedUsedPaths.some((path) => {
					return path.startsWith(`${currentPathStr}.`);
				});

				if (isUsedThisInPath && !isUsedInPath) {
					continue;
				}

				const isUsedInProps = usedProps.has(propName);

				if (!isUsedInPath && !isUsedInProps) {
					reportedProps.add(currentPathStr);
					context.report({
						node: reportNode,
						messageId: parentPath.length ? 'unusedNestedProp' : 'unusedProp',
						data: {
							name: propName,
							parent: parentPath.join('.')
						}
					});
					continue;
				}

				const isUsedNested = joinedUsedPaths.some((path) => {
					return path.startsWith(`${currentPathStr}.`);
				});

				if (isUsedNested || isUsedInProps) {
					checkUnusedProperties(
						propType,
						usedPaths,
						usedProps,
						reportNode,
						currentPath,
						checkedTypes,
						reportedProps
					);
				}
			}

			// Check for unused index signatures only at the root level
			if (parentPath.length === 0) {
				const indexType = type.getStringIndexType();
				const numberIndexType = type.getNumberIndexType();
				const hasIndexSignature = Boolean(indexType) || Boolean(numberIndexType);

				if (hasIndexSignature && !hasRestElement(usedProps)) {
					context.report({
						node: reportNode,
						messageId: 'unusedIndexSignature'
					});
				}
			}
		}

		/**
		 * Returns true if the destructuring pattern includes a rest element,
		 * which means all remaining properties are potentially used.
		 */
		function hasRestElement(usedProps: Set<string>): boolean {
			return usedProps.size === 0;
		}

		function normalizeUsedPaths(paths: PropertyPath[]): PropertyPath[] {
			const normalized: PropertyPath[] = [];
			for (const path of paths.sort((a, b) => a.length - b.length)) {
				if (path.length === 0) continue;
				if (normalized.some((p) => p.every((part, idx) => part === path[idx]))) {
					continue;
				}
				normalized.push(path);
			}
			return normalized;
		}

		return {
			'VariableDeclaration > VariableDeclarator': (node: TSESTree.VariableDeclarator) => {
				// Only check $props declarations
				if (
					node.init?.type !== 'CallExpression' ||
					node.init.callee.type !== 'Identifier' ||
					node.init.callee.name !== '$props'
				) {
					return;
				}

				const tsNode = tools.service.esTreeNodeToTSNodeMap.get(node) as ts.VariableDeclaration;
				if (!tsNode || !tsNode.type) return;

				const propType = typeChecker.getTypeFromTypeNode(tsNode.type);
				let usedPaths: PropertyPath[] = [];
				let usedProps = new Set<string>();

				if (node.id.type === 'ObjectPattern') {
					usedProps = getUsedPropertiesFromPattern(node.id);
					if (usedProps.size === 0) return;
					const identifiers = node.id.properties
						.filter((p): p is TSESTree.Property => p.type === 'Property')
						.map((p) => p.value)
						.filter((v): v is TSESTree.Identifier => v.type === 'Identifier');
					for (const identifier of identifiers) {
						const paths = getUsedNestedPropertyNames(identifier);
						usedPaths.push(...paths.map((path) => [identifier.name, ...path]));
					}
				} else if (node.id.type === 'Identifier') {
					usedPaths = getUsedNestedPropertyNames(node.id);
				}

				checkUnusedProperties(
					propType,
					normalizeUsedPaths(usedPaths),
					usedProps,
					node.id,
					[],
					new Set<string>(),
					new Set<string>()
				);
			}
		};
	}
});
