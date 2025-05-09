import type { RuleModule } from '../src/types.js';
import { rules } from '../src/utils/rules.js';

const categories = [
	'Possible Errors',
	'Security Vulnerability',
	'Best Practices',
	'Stylistic Issues',
	'Extension Rules',
	'SvelteKit',
	'Experimental',
	'System'
] as const;

const descriptions: Record<(typeof categories)[number], string> = {
	'Possible Errors': 'These rules relate to possible syntax or logic errors in Svelte code:',
	'Security Vulnerability': 'These rules relate to security vulnerabilities in Svelte code:',
	'Best Practices': 'These rules relate to better ways of doing things to help you avoid problems:',
	'Stylistic Issues': 'These rules relate to style guidelines, and are therefore quite subjective:',
	'Extension Rules':
		'These rules extend the rules provided by ESLint itself, or other plugins to work well in Svelte:',
	SvelteKit: 'These rules relate to SvelteKit and its best Practices.',
	Experimental:
		':warning: These rules are considered experimental and may change or be removed in the future:',
	System: 'These rules relate to this plugin works:'
};

const activeRules = rules.filter((rule) => !rule.meta.deprecated);
const svelteRules = activeRules;
const deprecatedRules = rules.filter((rule) => rule.meta.deprecated);

activeRules.forEach((rule) => {
	if (!categories.includes(rule.meta.docs.category)) {
		throw new Error(`missing categories:${rule.meta.docs.category}`);
	}
});

const categoryRules = categories.map((cat) => {
	return {
		title: cat,
		rules: svelteRules.filter((rule) => rule.meta.docs.category === cat)
	};
});

export default function renderRulesTableContent(
	buildRulePath = (ruleName: string) => `./rules/${ruleName}.md`
): string {
	// -----------------------------------------------------------------------------

	function toRuleRow(rule: RuleModule) {
		const mark = `${rule.meta.docs.recommended ? ':star:' : ''}${
			rule.meta.fixable ? ':wrench:' : ''
		}${rule.meta.hasSuggestions ? ':bulb:' : ''}${rule.meta.deprecated ? ':warning:' : ''}`;
		const link = `[${rule.meta.docs.ruleId}](${buildRulePath(rule.meta.docs.ruleName || '')})`;
		const description = rule.meta.docs.description || '(no description)';

		return `| ${link} | ${description} | ${mark} |`;
	}

	function toDeprecatedRuleRow(rule: RuleModule) {
		const link = `[${rule.meta.docs.ruleId}](${buildRulePath(rule.meta.docs.ruleName || '')})`;
		const replacedRules = rule.meta.replacedBy || [];
		const replacedBy = Array.isArray(replacedRules)
			? replacedRules.map((name) => `[svelte/${name}](${buildRulePath(name)})`).join(', ')
			: replacedRules.note;

		return `| ${link} | ${replacedBy || '(no replacement)'} |`;
	}

	// -----------------------------------------------------------------------------
	let rulesTableContent = categoryRules
		.map((cat) => {
			return `
## ${cat.title}

${descriptions[cat.title]}

| Rule ID | Description |    |
|:--------|:------------|:---|
${cat.rules.map(toRuleRow).join('\n')}
`;
		})
		.join('');

	// -----------------------------------------------------------------------------
	if (deprecatedRules.length >= 1) {
		rulesTableContent += `
## Deprecated

- :warning: We're going to remove deprecated rules in the next major release. Please migrate to successor/new rules.
- :innocent: We don't fix bugs which are in deprecated rules since we don't have enough resources.

| Rule ID | Replaced by |
|:--------|:------------|
${deprecatedRules.map(toDeprecatedRuleRow).join('\n')}
`;
	}
	return rulesTableContent;
}
