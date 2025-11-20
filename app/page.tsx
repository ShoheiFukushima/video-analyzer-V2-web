"use client";

import { useState } from "react";
import { SignInButton, SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import { VideoUploader } from "./components/VideoUploader";
import { ProcessingStatus } from "./components/ProcessingStatus";
import { Upload, Video, FileText, Zap, Clock } from "lucide-react";

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

  return (
    <main className="min-h-screen bg-white dark:bg-gray-900">
      {/* Header */}
      <header className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600 p-2 rounded-lg">
              <FileText className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                Video to Sheet
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                動画内容を瞬時にエクセル化
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <SignedOut>
              <SignInButton mode="modal">
                <button className="px-5 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors">
                  ログイン
                </button>
              </SignInButton>
              <SignInButton mode="modal">
                <button className="px-5 py-2 bg-indigo-600 text-sm font-medium text-white rounded-lg hover:bg-indigo-700 transition-colors">
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
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <SignedOut>
          {/* Hero Section */}
          <section className="text-center py-20 sm:py-28">
            <h2 className="text-4xl sm:text-6xl font-extrabold text-gray-900 dark:text-white leading-tight">
              面倒な動画の文字起こし、
              <br />
              <span className="text-indigo-600">一瞬で完了。</span>
            </h2>
            <p className="mt-6 max-w-2xl mx-auto text-lg text-gray-600 dark:text-gray-300">
              動画をアップロードするだけで、含まれるテキスト情報をAIが自動でExcelシートに出力。
              クライアントへの面倒な資料作成から、あなたを解放します。
            </p>
            <div className="mt-10">
              <SignInButton mode="modal">
                <button className="px-8 py-4 bg-indigo-600 text-lg font-bold text-white rounded-lg hover:bg-indigo-700 transition-transform hover:scale-105">
                  今すぐ時間を取り戻す
                </button>
              </SignInButton>
              <p className="mt-3 text-sm text-gray-500">アカウント登録は不要です</p>
            </div>
          </section>

          {/* Problem Section */}
          <section className="py-20">
            <div className="text-center">
                <p className="font-semibold text-indigo-600">こんなお悩みありませんか？</p>
                <h3 className="mt-2 text-3xl font-bold text-gray-900 dark:text-white">
                    その30分、もっと価値のある仕事に
                </h3>
            </div>
            <div className="mt-12 max-w-4xl mx-auto p-8 bg-gray-50 dark:bg-gray-800/50 rounded-2xl border border-gray-200 dark:border-gray-700">
                <div className="flex flex-col md:flex-row items-center gap-8">
                    <div className="flex-shrink-0">
                        <Clock className="w-24 h-24 text-gray-400 dark:text-gray-500"/>
                    </div>
                    <div>
                        <p className="text-lg text-gray-700 dark:text-gray-200">
                            「納品する動画に使われているテキスト、全部リストアップしてほしい」
                            <br/><br/>
                            クライアントや上司からのそんな一言で、再生と一時停止を繰り返し、手作業で文字を打ち込む...。
                            そんな単純ですが時間のかかる作業に、毎度 <strong className="font-bold text-red-500">30分以上</strong> を奪われていませんか？
                        </p>
                        <p className="mt-4 text-gray-600 dark:text-gray-400">
                            その時間は、本来あなたが集中すべきクリエイティブな作業や、次の企画を考えるための貴重な時間のはずです。
                        </p>
                    </div>
                </div>
            </div>
          </section>

          {/* Solution Section */}
          <section className="py-20">
            <div className="text-center">
                <p className="font-semibold text-indigo-600">解決策はシンプル</p>
                <h3 className="mt-2 text-3xl font-bold text-gray-900 dark:text-white">
                    たった3ステップで、資料作成が完了
                </h3>
            </div>
            <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
                {/* Step 1 */}
                <div className="text-center p-6 border border-gray-200 dark:border-gray-700 rounded-lg">
                    <div className="flex items-center justify-center w-16 h-16 bg-indigo-100 dark:bg-indigo-900/50 rounded-full mx-auto mb-4">
                        <Upload className="w-8 h-8 text-indigo-600 dark:text-indigo-400"/>
                    </div>
                    <h4 className="text-xl font-semibold text-gray-900 dark:text-white">1. 動画をアップロード</h4>
                    <p className="mt-2 text-gray-600 dark:text-gray-400">ドラッグ＆ドロップで動画ファイルを選択するだけ。</p>
                </div>
                {/* Step 2 */}
                <div className="text-center p-6 border border-gray-200 dark:border-gray-700 rounded-lg">
                    <div className="flex items-center justify-center w-16 h-16 bg-indigo-100 dark:bg-indigo-900/50 rounded-full mx-auto mb-4">
                        <Zap className="w-8 h-8 text-indigo-600 dark:text-indigo-400"/>
                    </div>
                    <h4 className="text-xl font-semibold text-gray-900 dark:text-white">2. AIが自動処理</h4>
                    <p className="mt-2 text-gray-600 dark:text-gray-400">AIが動画を解析し、テキスト情報を正確に抽出します。</p>
                </div>
                {/* Step 3 */}
                <div className="text-center p-6 border border-gray-200 dark:border-gray-700 rounded-lg">
                    <div className="flex items-center justify-center w-16 h-16 bg-indigo-100 dark:bg-indigo-900/50 rounded-full mx-auto mb-4">
                        <FileText className="w-8 h-8 text-indigo-600 dark:text-indigo-400"/>
                    </div>
                    <h4 className="text-xl font-semibold text-gray-900 dark:text-white">3. Excelをダウンロード</h4>
                    <p className="mt-2 text-gray-600 dark:text-gray-400">処理が終われば、いつでもExcelファイルをダウンロードできます。</p>
                </div>
            </div>
          </section>

           {/* Final CTA Section */}
           <section className="py-20 bg-gray-50 dark:bg-gray-800/50 rounded-2xl">
            <div className="text-center max-w-3xl mx-auto">
              <h3 className="text-3xl font-bold text-gray-900 dark:text-white">
                もう面倒な手作業に時間を奪われない
              </h3>
              <p className="mt-4 text-lg text-gray-600 dark:text-gray-300">
                Video to Sheet があれば、動画のレビューと情報共有が劇的にスムーズになります。
                今すぐその時短効果を体験してください。
              </p>
              <div className="mt-8">
                <SignInButton mode="modal">
                  <button className="px-8 py-4 bg-indigo-600 text-lg font-bold text-white rounded-lg hover:bg-indigo-700 transition-transform hover:scale-105">
                    無料で試してみる
                  </button>
                </SignInButton>
              </div>
            </div>
          </section>

        </SignedOut>

        <SignedIn>
          <div className="py-10 grid gap-8">
            {/* Upload Section */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
                動画をアップロード
              </h2>
              <VideoUploader
                onUploadSuccess={handleUploadSuccess}
                disabled={isProcessing}
              />
            </div>

            {/* Processing Status */}
            {uploadId && (
              <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
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
      </div>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto mt-16 px-4 sm:px-6 lg:px-8 py-8 text-center text-gray-500 text-sm">
        <p>© 2025 Video to Sheet. All rights reserved.</p>
      </footer>
    </main>
  );
}
