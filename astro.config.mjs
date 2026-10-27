import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://pinedamb.github.io',
  base: '/NamiO',
  output: 'static',
  vite: { plugins: [tailwindcss()] },
});
