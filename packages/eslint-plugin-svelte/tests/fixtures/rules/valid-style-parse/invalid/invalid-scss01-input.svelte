<div class="container">
  <div class="div-class">Hello</div>

  <span class="span-class">World!</span>
</div>

<style lang="scss">
  // This syntax is intentionally invalid CSS - this is to be used to test resiliency against invalid input
  .container {
    class .div-class/35
      # Weird comment
      color: red;

    .span-class begin
      font-weight: bold;
    end
  }
</style>
