
import React, { useState, useRef, useEffect } from 'react';
import { 
  Upload, 
  Scissors, 
  Type as FontIcon, 
  CheckCircle, 
  Download, 
  Loader2, 
  AlertCircle,
  PlusCircle,
  Sparkles,
  RefreshCw,
  Trash2
} from 'lucide-react';
import { AppStatus, SubtitleSegment, VideoMetadata } from './types';
import { analyzeVideoWithGemini } from './services/geminiService';

const App: React.FC = () => {
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [video, setVideo] = useState<VideoMetadata | null>(null);
  const [segments, setSegments] = useState<SubtitleSegment[]>([]);
  const [selectedSegments, setSelectedSegments] = useState<SubtitleSegment[]>([]);
  const [selectedText, setSelectedText] = useState<string>('');
  const [processingMsg, setProcessingMsg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [finalVideoUrl, setFinalVideoUrl] = useState<string | null>(null);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const text = selectedSegments.map(s => s.text).join('\n');
    setSelectedText(text);
  }, [selectedSegments]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    setVideo({
      name: file.name,
      size: file.size,
      duration: 0,
      url,
      file
    });
    setStatus(AppStatus.ANALYZING);
    startAnalysis(file);
  };

  const startAnalysis = async (file: File) => {
    try {
      const result = await analyzeVideoWithGemini(file, (msg) => setProcessingMsg(msg));
      setSegments(result);
      setStatus(AppStatus.READY);
    } catch (err: any) {
      setError(err.message || '分析失败');
      setStatus(AppStatus.IDLE);
    }
  };

  const handleAddSegment = (seg: SubtitleSegment) => {
    setSelectedSegments(prev => [...prev, seg]);
  };

  const handleRemoveSegment = (index: number) => {
    setSelectedSegments(prev => prev.filter((_, i) => i !== index));
  };

  // 辅助函数：绘制自动换行的文字
  const wrapText = (ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number) => {
    const words = text.split('');
    let line = '';
    const lines = [];

    for (let n = 0; n < words.length; n++) {
      let testLine = line + words[n];
      let metrics = ctx.measureText(testLine);
      let testWidth = metrics.width;
      if (testWidth > maxWidth && n > 0) {
        lines.push(line);
        line = words[n];
      } else {
        line = testLine;
      }
    }
    lines.push(line);

    // 从底部向上绘制
    const totalHeight = lines.length * lineHeight;
    let currentY = y - totalHeight + lineHeight;
    
    for (const l of lines) {
      ctx.strokeText(l, x, currentY);
      ctx.fillText(l, x, currentY);
      currentY += lineHeight;
    }
  };

  const composeVideoSegments = async (segs: SubtitleSegment[]): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const sourceVideo = document.createElement('video');
      sourceVideo.src = video!.url;
      sourceVideo.crossOrigin = "anonymous";
      sourceVideo.muted = false;
      sourceVideo.playsInline = true;

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) return reject("无法创建 Canvas 上下文");

      sourceVideo.onloadedmetadata = async () => {
        canvas.width = sourceVideo.videoWidth;
        canvas.height = sourceVideo.videoHeight;

        // 设置音频上下文以捕获原声
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const source = audioCtx.createMediaElementSource(sourceVideo);
        const dest = audioCtx.createMediaStreamDestination();
        source.connect(dest);
        source.connect(audioCtx.destination); // 同时输出到扬声器，以便合成时同步

        const videoStream = canvas.captureStream(30);
        const combinedStream = new MediaStream([
          ...videoStream.getVideoTracks(),
          ...dest.stream.getAudioTracks()
        ]);

        const recorder = new MediaRecorder(combinedStream, { 
          mimeType: 'video/webm;codecs=vp8,opus',
          videoBitsPerSecond: 5000000 
        });
        const chunks: Blob[] = [];

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data);
        };
        
        recorder.onstop = () => {
          audioCtx.close();
          resolve(new Blob(chunks, { type: 'video/webm' }));
        };

        recorder.start();

        for (const seg of segs) {
          setProcessingMsg(`正在录制片段: "${seg.text.substring(0, 15)}..."`);
          
          sourceVideo.currentTime = seg.startTime;
          // 等待跳转完成
          await new Promise(r => {
            const onSeeked = () => {
              sourceVideo.removeEventListener('seeked', onSeeked);
              r(null);
            };
            sourceVideo.addEventListener('seeked', onSeeked);
          });

          sourceVideo.play();
          
          const durationMs = (seg.endTime - seg.startTime) * 1000;
          const startRenderTime = Date.now();

          // 循环渲染每一帧
          await new Promise(r => {
            const renderFrame = () => {
              const elapsed = Date.now() - startRenderTime;
              
              if (elapsed >= durationMs || sourceVideo.paused) {
                sourceVideo.pause();
                r(null);
                return;
              }

              ctx.drawImage(sourceVideo, 0, 0, canvas.width, canvas.height);
              
              // 绘制带换行的字幕
              const fontSize = Math.floor(canvas.height / 18);
              ctx.font = `bold ${fontSize}px "Microsoft YaHei", sans-serif`;
              ctx.fillStyle = 'white';
              ctx.strokeStyle = 'rgba(0,0,0,0.8)';
              ctx.lineWidth = Math.max(2, fontSize / 8);
              ctx.textAlign = 'center';
              ctx.textBaseline = 'bottom';

              const maxWidth = canvas.width * 0.85;
              const lineHeight = fontSize * 1.2;
              const bottomY = canvas.height * 0.92;

              wrapText(ctx, seg.text, canvas.width / 2, bottomY, maxWidth, lineHeight);

              requestAnimationFrame(renderFrame);
            };
            requestAnimationFrame(renderFrame);
          });
        }

        // 停止录制前稍微等一下，确保最后一帧被捕获
        setTimeout(() => recorder.stop(), 500);
      };
      
      sourceVideo.onerror = () => reject("视频加载失败");
    });
  };

  const handleGenerateFinalVideo = async () => {
    if (selectedSegments.length === 0) {
      setError("请先在右侧列表中点击选择字幕片段");
      return;
    }
    
    setStatus(AppStatus.GENERATING);
    setProcessingMsg("准备合成视频与音频...");

    try {
      const blob = await composeVideoSegments(selectedSegments);
      const url = URL.createObjectURL(blob);
      setFinalVideoUrl(url);
      setStatus(AppStatus.COMPLETED);
    } catch (err: any) {
      console.error(err);
      setError("合成视频失败: " + (err.message || "未知错误"));
      setStatus(AppStatus.READY);
    }
  };

  const filteredSegments = segments.filter(s => !s.isRedundant);
  const redundantCount = segments.filter(s => s.isRedundant).length;

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center p-4 md:p-8">
      <header className="w-full max-w-6xl flex justify-between items-center mb-8">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600 p-2 rounded-xl shadow-lg shadow-indigo-500/20">
            <Scissors className="text-white w-6 h-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">
            NovaClip AI 智能剪辑
          </h1>
        </div>
        <div className="text-xs font-medium text-slate-500 uppercase tracking-widest bg-slate-900 px-3 py-1 rounded-full border border-slate-800">
          基于 Gemini 3.0
        </div>
      </header>

      <main className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-12 gap-8 flex-grow">
        
        <div className="lg:col-span-7 space-y-6">
          {status === AppStatus.IDLE && (
            <div 
              onClick={() => fileInputRef.current?.click()}
              className="group cursor-pointer border-2 border-dashed border-slate-800 hover:border-indigo-500/50 bg-slate-900/50 rounded-2xl aspect-video flex flex-col items-center justify-center transition-all duration-300"
            >
              <div className="bg-slate-800 p-4 rounded-full mb-4 group-hover:scale-110 transition-transform">
                <Upload className="text-slate-400 group-hover:text-indigo-400 w-8 h-8" />
              </div>
              <p className="text-slate-300 font-medium text-lg">上传需要剪辑的视频</p>
              <p className="text-slate-500 text-sm mt-2">支持常见视频格式</p>
              <input ref={fileInputRef} type="file" className="hidden" accept="video/*" onChange={handleFileUpload} />
            </div>
          )}

          {status !== AppStatus.IDLE && video && (
            <div className="relative rounded-2xl overflow-hidden bg-black aspect-video shadow-2xl border border-slate-800">
              <video ref={videoRef} src={video.url} className="w-full h-full object-contain" controls />
              {status === AppStatus.ANALYZING && (
                <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm flex flex-col items-center justify-center text-center p-6">
                  <Loader2 className="w-12 h-12 text-indigo-500 animate-spin mb-4" />
                  <p className="text-indigo-200 font-bold text-xl mb-2">正在进行 AI 语义分析...</p>
                  <p className="text-indigo-300/60 text-sm max-w-xs">{processingMsg}</p>
                </div>
              )}
            </div>
          )}

          <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6 shadow-xl">
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-2">
                <FontIcon className="text-indigo-400 w-5 h-5" />
                <h2 className="text-lg font-semibold text-slate-200">剪辑队列与预览字幕</h2>
              </div>
              <button onClick={() => setSelectedSegments([])} className="text-xs text-slate-500 hover:text-red-400 transition-colors flex items-center gap-1">
                <RefreshCw className="w-3 h-3" /> 清空队列
              </button>
            </div>
            
            <div className="space-y-2 max-h-48 overflow-y-auto mb-4 custom-scrollbar pr-2">
              {selectedSegments.length > 0 ? selectedSegments.map((seg, idx) => (
                <div key={`${seg.id}-${idx}`} className="flex items-center gap-3 bg-slate-800/50 p-2 rounded-lg border border-slate-700/50 group">
                  <span className="text-[10px] text-slate-500 font-mono w-16 text-center">{seg.startTime.toFixed(1)}s</span>
                  <p className="flex-grow text-sm text-slate-300 truncate">{seg.text}</p>
                  <button onClick={() => handleRemoveSegment(idx)} className="text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              )) : (
                <div className="h-20 flex items-center justify-center border border-dashed border-slate-800 rounded-lg text-slate-600 text-sm italic">
                  队列为空，请在右侧选择有效片段
                </div>
              )}
            </div>

            <div className="flex justify-between items-center">
              <p className="text-xs text-slate-500">
                {selectedSegments.length > 0 ? `已选 ${selectedSegments.length} 个片段，将按顺序合并。` : "未选择"}
              </p>
              <button
                disabled={selectedSegments.length === 0 || status === AppStatus.GENERATING}
                onClick={handleGenerateFinalVideo}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-8 py-3 rounded-xl font-bold transition-all shadow-lg shadow-indigo-600/20"
              >
                {status === AppStatus.GENERATING ? (
                  <><Loader2 className="w-5 h-5 animate-spin" /> {processingMsg.length > 10 ? '录制中...' : '准备中...'}</>
                ) : (
                  <><Sparkles className="w-5 h-5" /> 生成带字幕视频</>
                )}
              </button>
            </div>
          </div>
        </div>

        <div className="lg:col-span-5 flex flex-col h-[700px]">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl flex flex-col h-full shadow-xl">
            <div className="p-5 border-b border-slate-800 flex justify-between items-center bg-slate-900/50 rounded-t-2xl">
              <div>
                <h2 className="font-bold text-slate-200 text-lg">AI 语义识别结果</h2>
                <p className="text-xs text-slate-500">找到 {filteredSegments.length} 个精华片段</p>
              </div>
              {redundantCount > 0 && (
                <span className="text-[10px] px-2 py-1 bg-amber-500/10 text-amber-500 rounded border border-amber-500/20 font-bold">
                  剔除 {redundantCount} 个冗余
                </span>
              )}
            </div>
            
            <div className="flex-grow overflow-y-auto p-4 space-y-3 custom-scrollbar">
              {status === AppStatus.ANALYZING ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-500 space-y-4">
                  <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                  <p className="text-sm">正在转录并标记有用片段...</p>
                </div>
              ) : filteredSegments.length > 0 ? (
                filteredSegments.map((seg) => (
                  <div 
                    key={seg.id}
                    className="group bg-slate-800/30 hover:bg-slate-800/60 p-4 rounded-xl border border-slate-700/50 transition-all cursor-pointer relative hover:border-indigo-500/30"
                    onClick={() => handleAddSegment(seg)}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-[10px] font-mono text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded-full">
                        {seg.startTime.toFixed(2)}s - {seg.endTime.toFixed(2)}s
                      </span>
                      <PlusCircle className="w-4 h-4 opacity-0 group-hover:opacity-100 text-indigo-400 transition-opacity" />
                    </div>
                    <p className="text-sm text-slate-200 leading-relaxed line-clamp-3">{seg.text}</p>
                  </div>
                ))
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-slate-600 text-center px-8">
                  <Scissors className="w-8 h-8 mb-4 opacity-20" />
                  <p className="text-sm">等待视频上传并分析</p>
                </div>
              )}
            </div>

            <div className="p-4 bg-slate-950/30 border-t border-slate-800 rounded-b-2xl">
               <p className="text-[10px] text-slate-600 text-center uppercase tracking-widest font-bold">
                 点击片段添加到下方剪辑列表
               </p>
            </div>
          </div>
        </div>
      </main>

      {status === AppStatus.COMPLETED && finalVideoUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-xl p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 max-w-2xl w-full shadow-2xl scale-in-center">
            <div className="flex items-center gap-4 mb-8">
              <div className="w-12 h-12 bg-green-500/20 rounded-full flex items-center justify-center">
                <CheckCircle className="text-green-500 w-7 h-7" />
              </div>
              <div>
                <h2 className="text-2xl font-bold">剪辑完成！</h2>
                <p className="text-slate-400 text-sm">已生成包含音频和自动换行字幕的全新视频。</p>
              </div>
            </div>

            <div className="bg-black rounded-2xl overflow-hidden mb-8 aspect-video border border-slate-800">
               <video src={finalVideoUrl} controls className="w-full h-full" autoPlay />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <button onClick={() => setStatus(AppStatus.READY)} className="w-full bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold py-4 rounded-2xl transition-all">返回修改</button>
              <a href={finalVideoUrl} download={`NovaClip_${Date.now()}.webm`} className="flex items-center justify-center gap-3 w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-4 rounded-2xl transition-all shadow-xl shadow-indigo-600/20">
                <Download className="w-5 h-5" /> 立即下载
              </a>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="fixed bottom-8 right-8 bg-red-600 text-white px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-4 animate-slide-in border border-red-500/50 z-50">
          <AlertCircle className="w-6 h-6" />
          <div className="flex flex-col">
            <span className="font-bold text-sm">出现错误</span>
            <span className="text-xs text-red-100">{error}</span>
          </div>
          <button onClick={() => setError(null)} className="ml-4 p-1 hover:bg-white/20 rounded-full transition-colors">✕</button>
        </div>
      )}

      <style>{`
        @keyframes scale-in-center { 0% { transform: scale(0.9); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
        .scale-in-center { animation: scale-in-center 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) both; }
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #334155; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #475569; }
      `}</style>
    </div>
  );
};

export default App;
