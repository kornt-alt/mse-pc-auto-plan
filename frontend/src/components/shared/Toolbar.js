import React from 'react';
import PropTypes from 'prop-types';

/** แถบเครื่องมือ: children ชิดซ้าย, <Toolbar.End> ชิดขวา */
const Toolbar = ({ children, className = '' }) => (
  <div className={`mse-toolbar ${className}`.trim()}>{children}</div>
);

const End = ({ children }) => <div className="mse-toolbar__end">{children}</div>;

End.propTypes = { children: PropTypes.node };
Toolbar.propTypes = { children: PropTypes.node, className: PropTypes.string };

Toolbar.End = End;

export default Toolbar;
