"use client";

import { useState, useRef, DragEvent, useEffect } from 'react';
import { FileVideo, FileSpreadsheet, UploadCloud, Loader2, CheckCircle, ArrowRight, RefreshCw } from 'lucide-react';
import { ImageModal } from './ImageModal';
import { cn } from '@/lib/utils';

export function InteractiveDemo() {
  const [isDragging, setIsDragging] = useState(false);
  const [isDropped, setIsDropped] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (isDropped) return;

    setIsDropped(true);
    setIsProcessing(true);

    setTimeout(() => {
      setIsProcessing(false);
      setIsComplete(true);
    }, 2500);
  };

  const handleReset = () => {
    setIsDropped(false);
    setIsProcessing(false);
    setIsComplete(false);
    setIsModalOpen(false);
  };

  const handleDownloadClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setIsModalOpen(true);
  };

  return (
    <>
      <section className="py-20 md:py-28 bg-background">
        <div className="container">
          <div className="max-w-3xl mx-auto text-center">
            <p className="font-semibold text-primary">サービスを体験</p>
            <h2 className="mt-2 text-3xl md:text-4xl font-bold tracking-tight">
              わずか3ステップで完了
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              実際の操作をシミュレートして、本サービスのシンプルなプロセスを体験してください。
            </p>
          </div>

          <div className="mt-12 relative">
            {/* Background Lines */}
            <div className="hidden lg:block absolute top-1/2 left-0 w-full h-px bg-border -translate-y-1/2"></div>
            
            <div className="relative grid lg:grid-cols-3 gap-8">
              {/* Step 1: Upload */}
              <div className="flex flex-col items-center text-center">
                <div className="relative">
                  <div className="w-20 h-20 rounded-full bg-secondary flex items-center justify-center border-4 border-background">
                    <UploadCloud className="w-10 h-10 text-primary" />
                  </div>
                  <div className="absolute top-1/2 left-full ml-4 hidden lg:block">
                     <ArrowRight className="w-8 h-8 text-muted-foreground" />
                  </div>
                </div>
                <h3 className="mt-4 text-xl font-semibold">1. アップロード</h3>
                <p className="mt-2 text-muted-foreground">お手元の動画ファイルを<br />ドラッグ＆ドロップ</p>
              </div>

              {/* Step 2: Process */}
              <div className="flex flex-col items-center text-center">
                <div className="relative">
                  <div className="w-20 h-20 rounded-full bg-secondary flex items-center justify-center border-4 border-background">
                    <Loader2 className={cn("w-10 h-10 text-primary", isProcessing && "animate-spin")} />
                  </div>
                   <div className="absolute top-1/2 left-full ml-4 hidden lg:block">
                     <ArrowRight className="w-8 h-8 text-muted-foreground" />
                  </div>
                </div>
                <h3 className="mt-4 text-xl font-semibold">2. AIによる解析</h3>
                <p className="mt-2 text-muted-foreground">AIが動画をシーン分割し、<br />テキストを自動抽出</p>
              </div>

              {/* Step 3: Download */}
              <div className="flex flex-col items-center text-center">
                 <div className="w-20 h-20 rounded-full bg-secondary flex items-center justify-center border-4 border-background">
                    <FileSpreadsheet className={cn("w-10 h-10 transition-colors", isComplete ? "text-green-500" : "text-primary")} />
                  </div>
                <h3 className="mt-4 text-xl font-semibold">3. Excel出力</h3>
                <p className="mt-2 text-muted-foreground">抽出結果をExcel形式で<br />瞬時にダウンロード</p>
              </div>
            </div>
          </div>
          
          <div 
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            className={cn(
              "mt-12 w-full max-w-3xl mx-auto h-72 rounded-xl border-2 border-dashed flex flex-col items-center justify-center text-center p-8 transition-all duration-300",
              isDragging && !isDropped ? "border-primary bg-primary/10" : "border-border",
              isComplete && "border-green-500/50 bg-green-500/5"
            )}
          >
            {!isDropped && (
              <>
                <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center mb-4">
                  <FileVideo className="w-8 h-8 text-primary" />
                </div>
                <h3 className="text-xl font-semibold text-foreground">ここに動画ファイルをドラッグ＆ドロップ</h3>
                <p className="text-muted-foreground mt-1">シミュレーションを開始します</p>
              </>
            )}
            
            {isProcessing && (
               <>
                <Loader2 className="w-16 h-16 text-primary animate-spin" />
                <p className="mt-4 text-lg font-semibold text-primary">AIがテキストを抽出中...</p>
                <p className="text-muted-foreground">通常は数分で完了します</p>
              </>
            )}

            {isComplete && (
              <>
                <CheckCircle className="w-16 h-16 text-green-500" />
                <p className="mt-4 text-lg font-semibold text-green-600 dark:text-green-400">解析が完了しました！</p>
                <div className="mt-4 flex items-center gap-4">
                  <button 
                    onClick={handleDownloadClick}
                    className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-green-600 text-white hover:bg-green-600/90 h-10 px-4 py-2"
                  >
                    <FileSpreadsheet className="w-4 h-4" />
                    ダウンロード
                  </button>
                   <button 
                    onClick={handleReset}
                    className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-10 px-4 py-2"
                  >
                    <RefreshCw className="w-4 h-4" />
                    リセット
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </section>
      <ImageModal 
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        imageUrl="/excel-sample.png"
      />
    </>
  );
}

