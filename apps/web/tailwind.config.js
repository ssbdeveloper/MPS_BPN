/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#007bff',
          dark: '#0056b3',
          darker: '#004a99',
        },
        success: {
          DEFAULT: '#28a745',
          dark: '#1e7e34',
          darker: '#155724',
        },
        danger: {
          DEFAULT: '#ff6b6b',
          dark: '#c82333',
          darker: '#7a1b22',
        },
        warning: {
          DEFAULT: '#ffd966',
          dark: '#e0a800',
          darker: '#a07800',
        },
        secondary: {
          DEFAULT: '#adb5bd',
          dark: '#6c757d',
          darker: '#4a4f52',
        },
        brand: {
          'deep-twilight':    '#03045e',
          'french-blue':      '#023e8a',
          'bright-teal-blue': '#0077b6',
          'blue-green':       '#0096c7',
          'turquoise-surf':   '#00b4d8',
          'sky-aqua':         '#48cae4',
          'frosted-blue':     '#90e0ef',
          'frosted-blue-2':   '#ade8f4',
          'light-cyan':       '#caf0f8',
        },
        canvas: '#eef2f6',
        status: {
          late:    '#b45309',
          running: '#0077b6',
          ok:      '#047857',
        },
      },
      boxShadow: {
        '3d-primary': '0 4px 0 #004a99, 0 6px 12px rgba(0,0,0,0.2)',
        '3d-primary-active': '0 1px 0 #004a99, 0 3px 6px rgba(0,0,0,0.2)',
        '3d-success': '0 4px 0 #155724, 0 6px 12px rgba(0,0,0,0.2)',
        '3d-success-active': '0 1px 0 #155724, 0 3px 6px rgba(0,0,0,0.2)',
        '3d-danger': '0 4px 0 #7a1b22, 0 6px 12px rgba(0,0,0,0.2)',
        '3d-danger-active': '0 1px 0 #7a1b22, 0 3px 6px rgba(0,0,0,0.2)',
        '3d-warning': '0 4px 0 #a07800, 0 6px 12px rgba(0,0,0,0.2)',
        '3d-warning-active': '0 1px 0 #a07800, 0 3px 6px rgba(0,0,0,0.2)',
        '3d-secondary': '0 4px 0 #4a4f52, 0 6px 12px rgba(0,0,0,0.2)',
        '3d-secondary-active': '0 1px 0 #4a4f52, 0 3px 6px rgba(0,0,0,0.2)',
        card: '0 1px 2px rgba(15,23,42,.05), 0 4px 12px rgba(15,23,42,.06)',
      },
    },
  },
  plugins: [],
}
