"use client";

import { X } from 'lucide-react';

interface ImageModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageUrl: string;
}

export function ImageModal({ isOpen, onClose, imageUrl }: ImageModalProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-75 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div 
        className="relative bg-white dark:bg-gray-800 p-4 rounded-lg shadow-2xl max-w-4xl max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute -top-4 -right-4 bg-gray-700 text-white rounded-full p-1 hover:bg-gray-900 transition-colors z-10"
          aria-label="閉じる"
        >
          <X className="w-6 h-6" />
        </button>
        <img src={imageUrl} alt="Excel sample preview" className="max-w-full max-h-[85vh] object-contain" />
      </div>
    </div>
  );
}
