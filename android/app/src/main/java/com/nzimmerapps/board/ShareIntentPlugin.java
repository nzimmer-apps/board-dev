package com.nzimmerapps.board;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Hands text, images, PDFs or audio shared from other apps (Android share sheet) to the web layer. */
@CapacitorPlugin(name = "ShareIntent")
public class ShareIntentPlugin extends Plugin {
    static final class Shared {
        final String text;
        final String imageBase64;
        /** A PDF or audio file, as is (no re-encoding). */
        final String fileBase64;
        final String fileType;
        final String fileName;
        /** Set when a file was shared but could not be passed on (too big or unreadable). */
        final String error;
        Shared(String text, String imageBase64) { this(text, imageBase64, null, null, null, null); }
        Shared(String text, String imageBase64, String fileBase64, String fileType, String fileName, String error) {
            this.text = text;
            this.imageBase64 = imageBase64;
            this.fileBase64 = fileBase64;
            this.fileType = fileType;
            this.fileName = fileName;
            this.error = error;
        }
        JSObject toJs() {
            JSObject o = new JSObject();
            o.put("text", text);
            o.put("image", imageBase64);
            o.put("file", fileBase64);
            o.put("fileType", fileType);
            o.put("fileName", fileName);
            o.put("error", error);
            return o;
        }
    }

    private static Shared pending = null;

    static void setPending(Shared s) { pending = s; }

    /** Called by the web app on startup: returns any share that launched the app, then clears it. */
    @PluginMethod
    public void takePending(PluginCall call) {
        JSObject ret = pending == null ? new JSObject() : pending.toJs();
        pending = null;
        call.resolve(ret);
    }

    /** Called by MainActivity when a share arrives while the app is already open. */
    void emit(Shared s) {
        notifyListeners("shared", s.toJs(), true);
    }
}
