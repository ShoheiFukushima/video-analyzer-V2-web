"use client";

import { useState } from "react";
import { SignInButton, SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import { VideoUploader } from "./components/VideoUploader";
import { ProcessingStatus } from "./components/ProcessingStatus";
import { Clapperboard, Sparkles } from "lucide-react";
import { InteractiveDemo } from "./components/InteractiveDemo";

export default function Home() {
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isExcelDemoOpen, setIsExcelDemoOpen] = useState(false);

  const handleUploadSuccess = (id: string) => {
    setUploadId(id);
    setIsProcessing(true);
  };

  const handleProcessingComplete = () => {
    setIsProcessing(false);
  };

  return (
    <div className="flex flex-col min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 max-w-screen-2xl items-center justify-between">
          <a href="#" className="flex items-center gap-2">
            <Clapperboard className="w-7 h-7 text-primary" />
            <span className="text-xl font-bold tracking-tighter">
              Video to Sheet
            </span>
          </a>
          <div className="flex items-center gap-2">
            <SignedOut>
              <SignInButton mode="modal">
                <button className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 hover:bg-accent hover:text-accent-foreground h-10 px-4 py-2">
                  ログイン
                </button>
              </SignInButton>
              <SignInButton mode="modal">
                <button className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2">
                  無料で始める
                </button>
              </SignInButton>
            </SignedOut>
            <SignedIn>
              <UserButton afterSignOutUrl="/" />
            </SignedIn>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1">
        <SignedOut>
          {/* Hero Section */}
          <section className="container grid lg:grid-cols-2 gap-12 lg:gap-20 items-center py-20 md:py-32">
            <div className="flex flex-col items-start gap-6">
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-tighter">
                動画の文字起こし、
                <br />
                <span className="bg-gradient-to-r from-blue-500 to-cyan-400 bg-clip-text text-transparent">
                  AIで、次のステージへ。
                </span>
              </h1>
              <p className="max-w-xl text-lg text-muted-foreground">
                動画をアップロードするだけで、AIがテキスト情報を自動でExcelシートに出力。面倒な資料作成からあなたを解放し、本来のクリエイティブな仕事に集中させます。
              </p>
              <SignInButton mode="modal">
                <button className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-base font-semibold ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-12 px-8 py-3 shadow-lg">
                  <Sparkles className="w-5 h-5" />
                  今すぐ時間を取り戻す
                </button>
              </SignInButton>
            </div>
            <div className="relative h-full min-h-[300px] lg:min-h-[400px] rounded-2xl shadow-2xl overflow-hidden bg-slate-900 border">
                {/* A decorative element, maybe a code snippet or a stylized excel sheet */}
                <div className="absolute inset-0 bg-gradient-to-br from-blue-900/50 via-slate-900 to-cyan-900/50"></div>
                <div className="p-6 text-slate-300 font-mono text-sm">
                  <p><span className="text-cyan-400">1</span> // AIによるシーン分析</p>
                  <p><span className="text-cyan-400">2</span> process_video(file).then(scenes =&gt; &#123;</p>
                  <p><span className="text-cyan-400">3</span> &nbsp;&nbsp;scenes.forEach(scene =&gt; &#123;</p>
                  <p><span className="text-cyan-400">4</span> &nbsp;&nbsp;&nbsp;&nbsp;<span className="text-purple-400">extract_text</span>(scene.image);</p>
                  <p><span className="text-cyan-400">5</span> &nbsp;&nbsp;&nbsp;&nbsp;<span className="text-purple-400">add_to_excel</span>(scene.timestamp, scene.text);</p>
                  <p><span className="text-cyan-400">6</span> &nbsp;&nbsp;&#125;);</p>
                  <p><span className="text-cyan-400">7</span> &#125;);</p>
                </div>
                <div className="absolute bottom-4 right-4 flex items-center gap-2 rounded-full bg-black/50 px-3 py-1.5 text-xs text-white backdrop-blur-sm">
                    <Sparkles className="w-4 h-4 text-yellow-300" />
                    <span>Powered by AI</span>
                </div>
            </div>
          </section>

          {/* Problem Section */}
          <section className="bg-secondary/50 dark:bg-secondary/20 py-20 md:py-28">
            <div className="container">
              <div className="max-w-3xl mx-auto text-center">
                <p className="font-semibold text-primary">こんなお悩みありませんか？</p>
                <h2 className="mt-2 text-3xl md:text-4xl font-bold">
                  その単純作業、AIが代行します
                </h2>
                <p className="mt-4 text-lg text-muted-foreground">
                  クライアントや上司からの「動画のテキスト全部書き出して」という一言。再生と一時停止を繰り返し、時間を奪われる日々はもう終わりです。
                </p>
              </div>
              <div className="mt-12 max-w-2xl mx-auto p-8 bg-card rounded-2xl border shadow-sm">
                <p className="text-lg text-foreground/90">
                  「納品動画に使われているテキスト、全部リストアップしてほしい」
                  <br/><br/>
                  そんな一言で始まる、再生と一時停止の繰り返し...。
                  本来あなたが集中すべきクリエイティブな作業や、次の企画を考えるための貴重な時間が、<strong className="font-bold text-destructive">30分以上</strong>も奪われています。
                </p>
              </div>
            </div>
          </section>

          {/* Interactive Demo Section */}
          <InteractiveDemo />

          {/* Final CTA Section */}
          <section className="py-20 md:py-28">
            <div className="container text-center max-w-3xl mx-auto">
              <h2 className="text-3xl md:text-4xl font-bold">
                もう面倒な手作業に時間を奪われない
              </h2>
              <p className="mt-4 text-lg text-muted-foreground">
                Video to Sheet があれば、動画のレビューと情報共有が劇的にスムーズになります。今すぐその時短効果を体験してください。
              </p>
              <div className="mt-8">
                <SignInButton mode="modal">
                  <button className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-base font-semibold ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-12 px-8 py-3 shadow-lg">
                    無料で試してみる
                  </button>
                </SignInButton>
              </div>
            </div>
          </section>
        </SignedOut>

        <SignedIn>
          <div className="container py-10 grid gap-8">
            <div className="bg-card border rounded-xl shadow-sm p-8">
              <h2 className="text-2xl font-bold text-foreground mb-6">
                動画をアップロード
              </h2>
              <VideoUploader
                onUploadSuccess={handleUploadSuccess}
                disabled={isProcessing}
              />
            </div>

            {uploadId && (
              <div className="bg-card border rounded-xl shadow-sm p-8">
                <h2 className="text-2xl font-bold text-foreground mb-6">
                  処理ステータス
                </h2>
                <ProcessingStatus
                  uploadId={uploadId}
                  onComplete={handleProcessingComplete}
                />
              </div>
            )}
          </div>
        </SignedIn>
      </main>

      {/* Footer */}
      <footer className="border-t">
        <div className="container flex items-center justify-center py-6 text-sm text-muted-foreground">
          <p>© 2025 Video to Sheet. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
