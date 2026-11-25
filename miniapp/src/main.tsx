import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './theme.css';
import './app.css';
import { App } from './App';
import { initTelegram, loadBridge } from './tg';

initTelegram();

// В MAX сначала подключаем его скрипт (кнопка «Назад», переход в чат), потом рисуем.
void loadBridge().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
