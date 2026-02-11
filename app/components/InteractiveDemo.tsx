"use client";

import { useState, DragEvent } from 'react';
import { FileVideo, FileSpreadsheet, Loader2, CheckCircle, RefreshCw, Palette } from 'lucide-react';
import { ImageModal } from './ImageModal';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.15,
      delayChildren: 0.2,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 100 } },
};

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
      <motion.section 
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.2 }}
        variants={containerVariants}
        className="py-20 md:py-28"
      >
        <div className="container">
          <motion.div variants={itemVariants} className="max-w-3xl mx-auto text-center">
            <h2 className="text-4xl md:text-5xl font-serif font-bold">
              Your Digital Atelier
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              動画という名の素材を、AIの絵筆で新たな作品へ。
              <br />
              ドラッグ＆ドロップで、あなたの創造プロセスを体験してください。
            </p>
          </motion.div>
          
          <motion.div
            variants={itemVariants}
            layout
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            className={cn(
              "mt-12 w-full max-w-3xl mx-auto h-80 rounded-3xl border border-dashed flex flex-col items-center justify-center text-center p-8 transition-all duration-300 relative overflow-hidden",
              isDragging && !isDropped ? "border-primary/80 bg-primary/10 scale-105" : "border-border",
              isComplete && "border-green-500/30 bg-green-500/5",
              !isDropped && "bg-secondary/30"
            )}
          >
            <AnimatePresence mode="wait">
              {!isDropped && (
                <motion.div
                  key="initial"
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  className="flex flex-col items-center p-4"
                >
                  <motion.div
                    className="w-20 h-20 rounded-full bg-background border flex items-center justify-center mb-4 shadow-sm"
                    whileHover={{ scale: 1.1, rotate: 5 }}
                  >
                    <FileVideo className="w-9 h-9 text-primary" />
                  </motion.div>
                  <h3 className="text-xl font-serif font-medium text-foreground">ここに動画をドロップ</h3>
                  <p className="text-muted-foreground mt-1">新たな作品が生まれます</p>
                </motion.div>
              )}
              
              {isProcessing && (
                 <motion.div
                  key="processing"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className="flex flex-col items-center"
                >
                  <Loader2 className="w-16 h-16 text-primary animate-spin" />
                  <p className="mt-4 text-lg font-serif text-primary">描画中...</p>
                  <p className="text-muted-foreground">AIがあなたの動画を解釈しています</p>
                </motion.div>
              )}

              {isComplete && (
                <motion.div
                  key="complete"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.2, duration: 0.5 }}
                  className="flex flex-col items-center"
                >
                  <CheckCircle className="w-16 h-16 text-green-500" />
                  <p className="mt-4 text-2xl font-serif font-medium text-green-600 dark:text-green-400">作品が完成しました</p>
                  <p className="text-muted-foreground mt-1">いつでもダウンロードできます</p>
                  <div className="mt-6 flex items-center gap-4">
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={handleDownloadClick}
                      className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium ring-offset-background transition-colors bg-green-600 text-white hover:bg-green-600/90 h-10 px-5"
                    >
                      <FileSpreadsheet className="w-4 h-4" />
                      表示する
                    </motion.button>
                     <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={handleReset}
                      className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium ring-offset-background transition-colors border border-input bg-background hover:bg-accent/50 h-10 px-5"
                    >
                      <RefreshCw className="w-4 h-4" />
                      やり直す
                    </motion.button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </div>
      </motion.section>
      <ImageModal 
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        imageUrl="/excel-sample.png"
      />
    </>
  );
}

