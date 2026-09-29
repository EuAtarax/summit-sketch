import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import './styles.css';
import './ui/search.css';
import { mountApp } from './ui/app';
import { reloadWhenUpdated } from './ui/updates';

reloadWhenUpdated();

const root = document.getElementById('app');
if (root) mountApp(root);
