<a class="link">Click me!</a>

<a>Click me two!</a>

<b class="bold">Text 1</b>

<b data-key="val">Text 3</b>

<style>
  .link {
    color: red;
  }

  .bold {
    color: red;
  }

  .link:active {
    color: red;
  }

  .link + .bold {
    color: red;
  }

  .bold[data-key="val"] {
    color: red;
  }

  .bold::before {
    color: red;
  }
</style>
