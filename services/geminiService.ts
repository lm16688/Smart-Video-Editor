
import { GoogleGenAI, Type } from "@google/genai";
import { SubtitleSegment } from "../types";

const API_KEY = process.env.API_KEY || '';

export const analyzeVideoWithGemini = async (
  videoFile: File,
  onProgress: (msg: string) => void
): Promise<SubtitleSegment[]> => {
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  
  onProgress("正在转换视频以供分析...");
  const base64Video = await fileToBase64(videoFile);

  onProgress("Gemini 正在扫描语义和内容...");
  
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [
      {
        parts: [
          {
            inlineData: {
              mimeType: videoFile.type,
              data: base64Video.split(',')[1],
            },
          },
          {
            text: `请分析这段视频。执行以下操作：
            1. 转录语音，并提供精确的开始和结束时间戳（秒）。
            2. 识别“冗余”片段（静音、填充词如‘嗯/啊’、重复的镜头或无关的背景噪音）。
            3. 严格按照 JSON 数组格式返回结果，对象字段包含：
               id (字符串), startTime (数字), endTime (数字), text (字符串), isRedundant (布尔值), confidence (数字)。
               仅返回 JSON 数组，不要包含其他解释文本。`,
          },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            startTime: { type: Type.NUMBER },
            endTime: { type: Type.NUMBER },
            text: { type: Type.STRING },
            isRedundant: { type: Type.BOOLEAN },
            confidence: { type: Type.NUMBER },
          },
          required: ["id", "startTime", "endTime", "text", "isRedundant"],
        },
      },
    },
  });

  try {
    const segments = JSON.parse(response.text || "[]");
    return segments;
  } catch (error) {
    console.error("解析 Gemini 响应失败", error);
    return [];
  }
};

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (error) => reject(error);
  });
};
