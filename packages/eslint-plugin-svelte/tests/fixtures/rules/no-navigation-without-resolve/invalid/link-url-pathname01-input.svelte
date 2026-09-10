<script>
	const one = new URL('https://svelte.dev/blog');
</script>

<!-- .pathname is a bare internal path (/blog); it still needs resolve(). -->
<a href={one.pathname}>One</a>
<a href={one.pathname + one.search}>Two</a>
