"use client";

import { useState } from "react";
import { SignInButton, SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import { VideoUploader } from "./components/VideoUploader";
import { ProcessingStatus } from "./components/ProcessingStatus";
import { UploadHistory } from "./components/UploadHistory";
import { QuotaDisplay } from "./components/QuotaDisplay";
import { Brush, Sparkles } from "lucide-react";
import { InteractiveDemo } from "./components/InteractiveDemo";
import { motion } from "framer-motion";

const sectionVariants = {
  hidden: { opacity: 0, y: 40 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, ease: [0.4, 0, 0.2, 1] as const }
  },
};

const heroContainerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.2,
      delayChildren: 0.1,
    },
  },
};

const heroItemVariants = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.4, 0, 0.2, 1] as const } },
};


export default function Home() {
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleUploadSuccess = (id: string) => {
    setUploadId(id);
    setIsProcessing(true);
  };

  const handleProcessingComplete = () => {
    setIsProcessing(false);
  };

  const handleResumeProcessing = (id: string) => {
    setUploadId(id);
    setIsProcessing(true);
  };

  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur">
        <div className="container flex h-16 items-center justify-between">
          <a href="#" className="flex items-center gap-2.5">
            <Brush className="w-7 h-7 text-primary" />
            <span className="text-xl font-serif font-medium tracking-wide">
              Video Handoff
            </span>
          </a>
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <div className="flex items-center gap-2">
              <SignedOut>
                <SignInButton mode="modal">
                  <button className="px-4 py-2 text-sm font-medium transition-colors hover:text-primary">
                    ログイン
                  </button>
                </SignInButton>
                <SignInButton mode="modal">
                  <motion.button 
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className="inline-flex items-center justify-center whitespace-nowrap rounded-full text-sm font-medium ring-offset-background transition-colors bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-5">
                    無料で始める
                  </motion.button>
                </SignInButton>
              </SignedOut>
              <SignedIn>
                <UserButton />
              </SignedIn>
            </div>
          </motion.div>
        </div>
      </header>

      <main className="flex-1">
        <SignedOut>
          {/* Hero Section */}
          <motion.section
            variants={heroContainerVariants}
            initial="hidden"
            animate="visible"
            className="container pt-24 pb-20 md:pt-32 md:pb-28 text-center"
          >
            <motion.h1 variants={heroItemVariants} className="text-5xl md:text-7xl font-serif font-bold">
              テクノロジーに、<span className="text-primary">アート</span>の筆致を。
            </motion.h1>
            <motion.p variants={heroItemVariants} className="mt-6 max-w-2xl mx-auto text-lg md:text-xl text-muted-foreground">
              あなたの動画は、単なるデータではありません。
              <br />
              創造性のキャンバスに、AIという名の絵筆で、新たな価値を描き出します。
            </motion.p>
            <motion.div variants={heroItemVariants} className="mt-8">
              <SignInButton mode="modal">
                <motion.button
                  whileHover={{ scale: 1.05, y: -2 }}
                  whileTap={{ scale: 0.95 }}
                  className="inline-flex items-center justify-center gap-2.5 whitespace-nowrap rounded-full text-base font-medium ring-offset-background transition-all bg-primary text-primary-foreground hover:bg-primary/90 h-12 px-8 shadow-lg hover:shadow-primary/40"
                >
                  <Sparkles className="w-5 h-5" />
                  アトリエを体験する
                </motion.button>
              </SignInButton>
            </motion.div>
          </motion.section>
          
          <div className="relative">
            <div className="absolute inset-0 flex items-center" aria-hidden="true">
              <div className="w-full border-t border-dashed border-border" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-background px-3 text-muted-foreground">
                <Brush className="w-5 h-5" />
              </span>
            </div>
          </div>


          {/* Problem Section */}
          <motion.section 
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.3 }}
            variants={sectionVariants}
            className="container py-20 md:py-28"
          >
            <div className="grid lg:grid-cols-2 gap-12 items-center">
              <div className="max-w-md">
                <p className="font-semibold text-primary font-serif">The Task</p>
                <h2 className="mt-2 text-3xl md:text-4xl font-serif font-bold">
                  創造性の前に立ちはだかる、<br />退屈な作業。
                </h2>
              </div>
              <div>
                <p className="text-lg text-muted-foreground">
                  「この動画のテキスト、全部書き出して」。その一言が、あなたのインスピレーションを静止させる。再生、停止、タイピング。その繰り返しは、まるで乾いた絵の具のように、あなたの創造力を固めてしまう。失われた時間は、本来、新たな傑作を生み出すための貴重なひとときだったはず。
                </p>
              </div>
            </div>
          </motion.section>

          {/* Interactive Demo Section */}
          <InteractiveDemo />

          {/* Final CTA Section */}
          <motion.section 
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.3 }}
            variants={sectionVariants}
            className="bg-secondary/30 py-20 md:py-28"
          >
            <div className="container text-center max-w-3xl mx-auto">
              <h2 className="text-4xl md:text-5xl font-serif font-bold">
                今、創造の筆を、<br/>再びその手に。
              </h2>
              <p className="mt-6 text-lg text-muted-foreground">
                退屈な作業はAIという名の助手に任せ、あなたは物語を紡ぐことに集中する。Video Handoffは、すべてのクリエイターのための、新しい画材です。
              </p>
              <div className="mt-8">
                <SignInButton mode="modal">
                  <motion.button 
                    whileHover={{ scale: 1.05, y: -2 }}
                    whileTap={{ scale: 0.95 }}
                    className="inline-flex items-center justify-center gap-2.5 whitespace-nowrap rounded-full text-base font-medium ring-offset-background transition-all bg-primary text-primary-foreground hover:bg-primary/90 h-12 px-8 shadow-lg hover:shadow-primary/40">
                    無料でアトリエに入る
                  </motion.button>
                </SignInButton>
              </div>
            </div>
          </motion.section>
        </SignedOut>

        <SignedIn>
           <div className="container py-10 grid gap-8">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
              <QuotaDisplay />
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
              <div className="bg-card border rounded-xl shadow-sm p-8">
                <h2 className="text-2xl font-bold font-serif text-foreground mb-6">
                  Upload your canvas
                </h2>
                <VideoUploader
                  onUploadSuccess={handleUploadSuccess}
                  disabled={isProcessing}
                />
              </div>
            </motion.div>

            {uploadId && (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
                <div className="bg-card border rounded-xl shadow-sm p-8">
                  <h2 className="text-2xl font-bold font-serif text-foreground mb-6">
                    Palette status
                  </h2>
                  <ProcessingStatus
                    uploadId={uploadId}
                    onComplete={handleProcessingComplete}
                  />
                </div>
              </motion.div>
            )}

            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
              <UploadHistory
                onResumeProcessing={handleResumeProcessing}
                currentUploadId={uploadId}
              />
            </motion.div>
          </div>
        </SignedIn>
      </main>

      <footer className="border-t">
        <div className="container flex items-center justify-center py-8 text-sm text-muted-foreground">
          <p>© 2025 Video Handoff. Crafted with passion.</p>
        </div>
      </footer>
    </div>
  );
}
