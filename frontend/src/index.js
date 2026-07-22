import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import reportWebVitals from './reportWebVitals';

// ลำดับสำคัญ: bootstrap ก่อน แล้วค่อย theme ของเรา (ไม่งั้น bootstrap ชนะเมื่อ specificity เท่ากัน)
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css'; // โหลดจาก node_modules ไม่ใช่ CDN (เครือข่ายโรงงานออกเน็ตไม่ได้)
import './index.css';
import './theme/theme.css';

import 'bootstrap/dist/js/bootstrap.bundle.min.js';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
