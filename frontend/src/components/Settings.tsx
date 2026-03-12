import React, { useState } from "react";
import { useStore } from "@/store/useStore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { notifySuccess } from "@/lib/notify";
import { GlowPanel } from "@/components/ui/twenty-first";
import { Trash2, Save, Moon, Sun, Monitor } from "lucide-react";

const Settings: React.FC = () => {
  const { llmConfig, setLlmConfig, themeMode, setThemeMode, densityMode, setDensityMode } = useStore();
  
  const [apiKey, setApiKey] = useState(llmConfig.apiKey);
  const [baseUrl, setBaseUrl] = useState(llmConfig.baseUrl);
  const [model, setModel] = useState(llmConfig.model);

  const handleSaveLLM = () => {
    setLlmConfig({ ...llmConfig, apiKey, baseUrl, model });
    notifySuccess("模型配置已保存");
  };

  const handleClearData = () => {
    if (window.confirm("确定要清除所有本地缓存数据吗？这将包括登录状态和部分配置。")) {
      localStorage.clear();
      window.location.reload();
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6 bg-grid-white/[0.02]">
      <div className="max-w-3xl mx-auto space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">设置</h1>
        
        {/* Appearance */}
        <GlowPanel>
          <Card className="border-0 shadow-none bg-transparent">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Monitor size={20} />
                界面外观
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <div className="font-medium">深色模式</div>
                  <div className="text-sm text-muted-foreground">切换应用的主题颜色</div>
                </div>
                <div className="flex items-center gap-2 bg-muted p-1 rounded-full">
                  <Button 
                    variant={themeMode === "light" ? "default" : "ghost"} 
                    size="sm" 
                    className="h-8 rounded-full px-3"
                    onClick={() => setThemeMode("light")}
                  >
                    <Sun size={14} className="mr-1" /> 浅色
                  </Button>
                  <Button 
                    variant={themeMode === "dark" ? "default" : "ghost"} 
                    size="sm" 
                    className="h-8 rounded-full px-3"
                    onClick={() => setThemeMode("dark")}
                  >
                    <Moon size={14} className="mr-1" /> 深色
                  </Button>
                </div>
              </div>
              
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <div className="font-medium">紧凑模式</div>
                  <div className="text-sm text-muted-foreground">缩小界面间距，显示更多内容</div>
                </div>
                <Switch 
                  checked={densityMode === "compact"}
                  onCheckedChange={(c) => setDensityMode(c ? "compact" : "comfortable")}
                />
              </div>
            </CardContent>
          </Card>
        </GlowPanel>

        {/* Model Config */}
        <GlowPanel>
          <Card className="border-0 shadow-none bg-transparent">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Save size={20} />
                模型配置
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                <label className="text-sm font-medium">Base URL</label>
                <Input 
                  value={baseUrl} 
                  onChange={(e) => setBaseUrl(e.target.value)} 
                  placeholder="例如: http://localhost:1234/v1" 
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium">API Key</label>
                <Input 
                  type="password"
                  value={apiKey} 
                  onChange={(e) => setApiKey(e.target.value)} 
                  placeholder="lm-studio (本地可留空)" 
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium">Model Name</label>
                <Input 
                  value={model} 
                  onChange={(e) => setModel(e.target.value)} 
                  placeholder="例如: local-model" 
                />
              </div>
              <div className="pt-2">
                <Button onClick={handleSaveLLM} className="w-full sm:w-auto">
                  保存配置
                </Button>
              </div>
            </CardContent>
          </Card>
        </GlowPanel>

        {/* Danger Zone */}
        <Card className="border-destructive/20 bg-destructive/5">
          <CardHeader>
            <CardTitle className="text-destructive flex items-center gap-2">
              <Trash2 size={20} />
              危险区域
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <div className="font-medium">清除缓存数据</div>
                <div className="text-sm text-muted-foreground">清除浏览器本地存储的所有配置和状态</div>
              </div>
              <Button variant="destructive" onClick={handleClearData}>
                清除数据
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Settings;
