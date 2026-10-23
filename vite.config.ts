import {defineConfig} from 'vite';
export default defineConfig({root:'console',envDir:false,envPrefix:'CREDENCE_PUBLIC_',publicDir:false,
 build:{outDir:'../dist/console',emptyOutDir:true,sourcemap:false,target:'es2022'}});
