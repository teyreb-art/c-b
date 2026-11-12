import { mkdir, copyFile, cp, rm } from 'node:fs/promises';
await rm('public', { recursive: true, force: true });
await mkdir('public', { recursive: true });
for (const file of ['index.html', 'style.css', 'script.js']) {
  await copyFile(file, 'public/' + file);
}
await cp('assets', 'public/assets', { recursive: true });
await cp('beheer', 'public/beheer', { recursive: true });
console.log('Website en dashboard gebouwd in public/.');
