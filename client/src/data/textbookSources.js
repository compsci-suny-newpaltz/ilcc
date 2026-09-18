// Vite includes the original source text in the build; no server request needed.
const sources = import.meta.glob('./textbook/*.c', { query: '?raw', import: 'default', eager: true });

export const textbookSources = Object.entries(sources)
  .map(([path, content]) => {
    const name = path.split('/').at(-1);
    return { name, chapter: Number(name.match(/^c(\d{2})/)[1]), content };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

export const textbookChapters = [...new Set(textbookSources.map(source => source.chapter))];
