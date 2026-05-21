import React from 'react';
import { RouterProvider } from 'react-router-dom';
import { Toaster } from 'sonner';
import router from './router';

/**
 * Main App Component
 * Entry point aplikasi dengan React Router
 */
function App() {
  return (
    <>
      <RouterProvider router={router} />
      <Toaster
        position="top-right"
        richColors
        duration={5000}
        closeButton
        expand={false}
      />
    </>
  );
}

export default App;
