import { useTheme } from "@/components/theme-provider";
import { useWebSocket } from "@/contexts/WebSocketContext";
import { useImageCompression } from "@/hooks/useImageCompression";
import { useState, useEffect } from "react";
import { Moon, Sun, User as UserIcon, Save, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SettingsView() {
    const { theme, setTheme } = useTheme();
    const { currentUser, setUsername } = useWebSocket();
    const [nameInput, setNameInput] = useState(currentUser?.username || "");
    const [isSaved, setIsSaved] = useState(false);
    const { compressImages, setCompressImages } = useImageCompression();

    useEffect(() => {
        if (currentUser?.username) {
            setNameInput(currentUser.username);
        }
    }, [currentUser]);

    const handleSaveName = () => {
        if (nameInput.trim().length > 0 && nameInput !== currentUser?.username) {
            setUsername(nameInput.trim());
            setIsSaved(true);
            setTimeout(() => setIsSaved(false), 2000);
        }
    };

    return (
        <div className="flex-1 overflow-y-auto p-6 md:p-8">
            <div className="max-w-2xl mx-auto space-y-8">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight mb-2">Settings</h2>
                    <p className="text-muted-foreground">Manage your app preferences and identity.</p>
                </div>

                {/* Identity Settings */}
                <div className="space-y-4">
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                        <UserIcon className="w-5 h-5" />
                        Identity
                    </h3>
                    <div className="p-6 border rounded-lg bg-card space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="username">Display Name</Label>
                            <div className="flex gap-3">
                                <Input
                                    id="username"
                                    value={nameInput}
                                    onChange={(e) => setNameInput(e.target.value)}
                                    placeholder="Enter a cool username..."
                                    maxLength={24}
                                    className="max-w-xs"
                                />
                                <Button
                                    onClick={handleSaveName}
                                    disabled={nameInput.trim() === currentUser?.username || nameInput.trim() === ""}
                                >
                                    {isSaved ? "Saved!" : <><Save className="w-4 h-4 mr-2" /> Save</>}
                                </Button>
                            </div>
                            <p className="text-sm text-muted-foreground mt-2">
                                This identity is completely anonymous and will reset if you clear your cache.
                            </p>
                        </div>
                    </div>
                </div>

                {/* File Upload Settings */}
                <div className="space-y-4">
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                        <ImageIcon className="w-5 h-5" />
                        File Uploads
                    </h3>
                    <div className="p-6 border rounded-lg bg-card space-y-4">
                        <div className="flex items-center justify-between">
                            <div className="space-y-1">
                                <Label>Image Quality</Label>
                                <p className="text-sm text-muted-foreground">Choose whether to compress images before sending.</p>
                            </div>
                            <div className="flex gap-2 bg-muted p-1 rounded-md shrink-0">
                                <Button
                                    variant={compressImages ? "ghost" : "default"}
                                    size="sm"
                                    onClick={() => setCompressImages(false)}
                                    className="px-3"
                                >
                                    Original
                                </Button>
                                <Button
                                    variant={compressImages ? "default" : "ghost"}
                                    size="sm"
                                    onClick={() => setCompressImages(true)}
                                    className="px-3"
                                >
                                    Compressed
                                </Button>
                            </div>
                        </div>
                        <p className="text-sm text-muted-foreground mt-2">
                            Compression is only applied to images on the device before they are uploaded. Other file types are sent as-is.
                        </p>
                    </div>
                </div>

                {/* Appearance Settings */}
                <div className="space-y-4">
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                        <Sun className="w-5 h-5 dark:hidden" />
                        <Moon className="w-5 h-5 hidden dark:block" />
                        Appearance
                    </h3>
                    <div className="p-6 border rounded-lg bg-card flex items-center justify-between">
                        <div className="space-y-1">
                            <Label>Theme Interface</Label>
                            <p className="text-sm text-muted-foreground">Switch between light and dark modes.</p>
                        </div>
                        <div className="flex gap-2 bg-muted p-1 rounded-md">
                            <Button
                                variant={theme === "light" ? "default" : "ghost"}
                                size="sm"
                                onClick={() => setTheme("light")}
                                className="w-20"
                            >
                                <Sun className="w-4 h-4 mr-2" />
                                Light
                            </Button>
                            <Button
                                variant={theme === "dark" ? "default" : "ghost"}
                                size="sm"
                                onClick={() => setTheme("dark")}
                                className="w-20"
                            >
                                <Moon className="w-4 h-4 mr-2" />
                                Dark
                            </Button>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
}
