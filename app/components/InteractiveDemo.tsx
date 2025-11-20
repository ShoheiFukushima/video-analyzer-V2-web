"use client";

import { useState, useRef, DragEvent } from 'react';
import { FileVideo, FileSpreadsheet, UploadCloud, Loader2 } from 'lucide-react';

export function InteractiveDemo() {
  const [isDragging, setIsDragging] = useState(false);
  const [isDropped, setIsDropped] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const dragItemRef = useRef<HTMLDivElement | null>(null);

  const handleDragStart = (e: DragEvent<HTMLDivElement>) => {
    setIsDragging(true);
    if (dragItemRef.current) {
      e.dataTransfer.setData('text/plain', dragItemRef.current.id);
      e.dataTransfer.effectAllowed = 'move';
    }
  };

  const handleDragEnd = () => {
    setIsDragging(false);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); 
  };

  const handleDragEnter = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!isDropped) {
      e.currentTarget.classList.add('bg-indigo-50', 'dark:bg-indigo-900/50', 'border-indigo-500');
    }
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (!isDropped) {
        e.currentTarget.classList.remove('bg-indigo-50', 'dark:bg-indigo-900/50', 'border-indigo-500');
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (isDropped) return;

    e.currentTarget.classList.remove('bg-indigo-50', 'dark:bg-indigo-900/50', 'border-indigo-500');
    setIsDropped(true);
    setIsProcessing(true);

    setTimeout(() => {
      setIsProcessing(false);
      setIsComplete(true);
    }, 3000);
  };

  const handleReset = () => {
    setIsDropped(false);
    setIsProcessing(false);
    setIsComplete(false);
  }

  return (
    <section className="py-20">
      <div className="text-center">
          <p className="font-semibold text-indigo-600">サービスを体験</p>
          <h3 className="mt-2 text-3xl font-bold text-gray-900 dark:text-white">
              実際の流れをデモで体験
          </h3>
          <p className="mt-4 max-w-2xl mx-auto text-gray-600 dark:text-gray-400">
            下の動画ファイルをドラッグして、アップロードエリアにドロップしてみてください。
          </p>
      </div>
      
      <div className="mt-12 max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8 items-center">
        {/* 1. Draggable File */}
        <div className="flex flex-col items-center justify-center h-full">
            <p className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-4">1. 動画ファイル</p>
            <div
                id="video-file"
                ref={dragItemRef}
                draggable={!isDropped}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                className={`flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-lg transition-all ${
                    isDropped ? 'cursor-not-allowed opacity-30' : 'cursor-grab hover:border-indigo-500 hover:bg-gray-50 dark:hover:bg-gray-800'
                }`}
            >
                <FileVideo className="w-16 h-16 text-blue-500" />
                <span className="mt-2 text-sm font-medium text-gray-700 dark:text-gray-300">my-video.mp4</span>
            </div>
        </div>

        <div className="text-5xl text-center text-gray-400 dark:text-gray-600 hidden md:block">
            →
        </div>

        {/* 2. Drop Zone & Result */}
        <div className="flex flex-col items-center justify-center h-full">
          <p className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-4">
            {isComplete ? '3. Excel出力' : '2. アップロード'}
          </p>
          <div
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            className="w-full h-48 border-2 border-dashed rounded-lg flex items-center justify-center text-center p-4 transition-colors relative"
          >
            {!isDropped && (
              <div className="text-gray-500 dark:text-gray-400">
                <UploadCloud className="w-12 h-12 mx-auto mb-2"/>
                <p className="font-semibold">ここにドラッグ＆ドロップ</p>
              </div>
            )}
            
            {isProcessing && (
              <div className="flex flex-col items-center">
                <Loader2 className="w-12 h-12 text-indigo-600 animate-spin" />
                <p className="mt-4 text-gray-600 dark:text-gray-300">AIがテキストを抽出中...</p>
              </div>
            )}

            {isComplete && (
              <div className="flex flex-col items-center text-center">
                  <FileSpreadsheet className="w-16 h-16 text-green-500" />
                  <span className="my-2 text-sm font-medium text-gray-700 dark:text-gray-300">video-text.xlsx</span>
                  <button className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700">
                    ダウンロード
                  </button>
              </div>
            )}

            {(isDropped && !isProcessing) && (
              <button onClick={handleReset} className="absolute top-2 right-2 text-xs text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">
                リセット
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
