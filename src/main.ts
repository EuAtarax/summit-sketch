import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import './styles.css';
import { mountApp } from './ui/app';

const root = document.getElementById('app');
if (root) mountApp(root);
