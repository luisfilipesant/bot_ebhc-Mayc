/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
    "./index.html",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#6B46C1',
        secondary: '#FFFFFF',
      },
    },
  },
  plugins: [
    
    require('tailwindcss'),
    require('autoprefixer')
],
};

