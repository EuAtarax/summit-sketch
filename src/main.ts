import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import './styles.css';
import { mountShell } from './ui/shell';

const root = document.getElementById('app');
if (root) mountShell(root);
