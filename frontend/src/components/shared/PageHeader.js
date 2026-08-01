import React from 'react';
import PropTypes from 'prop-types';

/**
 * หัวหน้าเว็บมาตรฐาน — ทุกหน้าใช้ตัวนี้ เพื่อให้ขนาด/ระยะห่างตรงกัน
 * icon    = class ของ Bootstrap Icons เช่น 'bi-list-check'
 * status  = slot สำหรับตัวบอกสถานะ (เช่น ไฟ Last plan / Last Edit ของหน้า Orders)
 * actions = ปุ่มชิดขวา
 */
const PageHeader = ({ icon, title, subtitle, status, actions }) => (
  <div className="page-header">
    <div>
      <h1 className="page-header__title">
        {icon && <i className={`bi ${icon}`} aria-hidden="true" />}
        {title}
      </h1>
      {subtitle && <p className="page-header__subtitle">{subtitle}</p>}
    </div>
    {status}
    <div className="page-header__actions">{actions}</div>
  </div>
);

PageHeader.propTypes = {
  icon: PropTypes.string,
  title: PropTypes.node.isRequired,
  subtitle: PropTypes.node,
  status: PropTypes.node,
  actions: PropTypes.node,
};

export default PageHeader;
