import React from 'react';

const Footer = () => {
  return (
    <footer className="bg-gray-900/60 backdrop-blur-md border-t border-gray-800 py-4 mt-auto">
      <div className="container mx-auto px-4">
        <div className="flex flex-col md:flex-row justify-between items-center">
          <div className="text-sm text-gray-400 mb-2 md:mb-0">
            Random Video Chat App © {new Date().getFullYear()}
          </div>
          
          <div className="text-xs text-gray-500">
            <span>Powered by WebRTC + Telegram Mini App</span>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;