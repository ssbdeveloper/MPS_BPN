import React from 'react';

/**
 * Page Container - Layout utama halaman
 * Dibuat berdasarkan CSS dari main.css (.page-container)
 */
export const PageContainer = ({ children, className = '' }) => {
  return (
    <div className={`flex flex-col h-full p-2.5 gap-2.5 ${className}`}>
      {children}
    </div>
  );
};

/**
 * App Header - Header aplikasi dengan gradient
 * Dibuat berdasarkan CSS dari main.css (.app-header)
 */
export const AppHeader = ({
  title,
  rightContent,
  className = ''
}) => {
  return (
    <div className={`
      flex justify-between items-center
      bg-gradient-to-br from-primary to-primary-dark
      text-white px-1.5 py-1.5 rounded-xl shadow-md
      font-semibold tracking-wide
      ${className}
    `}>
      <h2 className="m-0 text-xl font-bold">{title}</h2>
      {rightContent && <div>{rightContent}</div>}
    </div>
  );
};

/**
 * Status Bar - Bar untuk menampilkan status
 * Dibuat berdasarkan CSS dari main.css (.status-bar)
 */
export const StatusBar = ({
  leftContent,
  rightContent,
  className = ''
}) => {
  return (
    <div className={`
      flex justify-between items-center
      bg-[#e9ecef] px-4 py-2.5 rounded-md
      text-sm text-gray-800
      ${className}
    `}>
      <div>{leftContent}</div>
      <div>{rightContent}</div>
    </div>
  );
};

/**
 * Container Horizontal - Flex container horizontal
 * Dibuat berdasarkan CSS dari style.css (.container-horizontal)
 */
export const ContainerHorizontal = ({
  children,
  className = '',
  border = true
}) => {
  return (
    <div className={`
      flex flex-row bg-white p-2.5 rounded-xl
      w-screen h-dvh justify-center items-center
      gap-2.5
      ${border ? 'border-2 border-gray-300' : ''}
      ${className}
    `}>
      {children}
    </div>
  );
};

/**
 * Container Vertical - Flex container vertical
 * Dibuat berdasarkan CSS dari style.css (.container-vertical)
 */
export const ContainerVertical = ({
  children,
  className = '',
  border = true
}) => {
  return (
    <div className={`
      flex flex-col bg-white p-1.5 rounded-xl
      w-screen h-dvh justify-center items-center
      gap-2.5
      ${border ? 'border-2 border-gray-300' : ''}
      ${className}
    `}>
      {children}
    </div>
  );
};

/**
 * Menu Grid - Grid layout untuk menu items
 * Dibuat berdasarkan CSS dari main.css (.menu-grid)
 */
export const MenuGrid = ({ children, className = '' }) => {
  return (
    <div className={`
      grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))]
      gap-2.5 flex-1
      ${className}
    `}>
      {children}
    </div>
  );
};

export default {
  PageContainer,
  AppHeader,
  StatusBar,
  ContainerHorizontal,
  ContainerVertical,
  MenuGrid
};
