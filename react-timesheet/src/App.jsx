import React from 'react';
import { RouterProvider } from 'react-router-dom';
import router from './router';

/**
 * Main App Component
 * Entry point aplikasi dengan React Router
 */
function App() {
  return <RouterProvider router={router} />;
}

export default App;
