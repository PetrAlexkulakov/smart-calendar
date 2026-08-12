import { Route, Routes } from 'react-router';

import { MainPage } from './pages/MainPage.tsx';
import { NotFoundPage } from './pages/NotFoundPage.tsx';
import { Vitrin } from './pages/Vitrin.tsx';

export function App() {
  return (
    <Routes>
      <Route index element={<MainPage />} />
      <Route path="/vitrin" element={<Vitrin />} />
      <Route path="/*" element={<NotFoundPage />} />
    </Routes>
  );
}
