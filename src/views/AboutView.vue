<template>
  <div class="about">
    <h1>关于</h1>
    <p>本站为个人小工具集合，部署于 GitHub Pages。</p>
    <p>
      GitHub 项目地址：
      <a
        href="https://github.com/miloweimo/tool"
        target="_blank"
        rel="noopener noreferrer"
      >https://github.com/miloweimo/tool</a>
    </p>
    <p>
      作者主页：
      <a
        href="https://github.com/miloweimo"
        target="_blank"
        rel="noopener noreferrer"
      >https://github.com/miloweimo</a>
    </p>
  </div>
</template>

<style scoped>
.about {
  max-width: 40rem;
  margin: 0 auto;
  padding: 1.25rem 0 2rem;
}

h1 {
  font-size: 1.5rem;
  color: var(--color-heading);
  margin-bottom: 0.75rem;
}

p {
  color: var(--color-text);
  line-height: 1.6;
  margin: 0;
}

p + p {
  margin-top: 0.75rem;
}

a {
  color: var(--color-heading);
  text-decoration: underline;
  text-underline-offset: 0.15em;
}

a:hover {
  opacity: 0.85;
}
</style>
