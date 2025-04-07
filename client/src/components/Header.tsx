import React from 'react';
import { Video } from 'lucide-react';

interface HeaderProps {
  statusMessage: string;
}

const Header = ({ statusMessage }: HeaderProps) => {
  return (
    <header className="bg-gray-900/60 backdrop-blur-md border-b border-gray-800 sticky top-0 z-50 py-3">
      <div className="container mx-auto px-4">
        <div className="flex justify-between items-center">
          <div className="flex items-center space-x-2">
            <Video className="h-6 w-6 text-blue-400" />
            <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
              Random Video Chat
            </h1>
          </div>
          
          <div className="text-sm text-gray-400">
            <span>{statusMessage}</span>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;