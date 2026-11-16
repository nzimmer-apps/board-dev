package com.nzimmerapps.board;

import android.content.Intent;
import android.database.Cursor;
import android.provider.OpenableColumns;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Base64;
import androidx.exifinterface.media.ExifInterface;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;

public class MainActivity extends BridgeActivity {
    private static final int MAX_SIDE = 1600;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ShareIntentPlugin.class);
        super.onCreate(savedInstanceState);
        ShareIntentPlugin.Shared s = extract(getIntent());
        if (s != null) ShareIntentPlugin.setPending(s);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        ShareIntentPlugin.Shared s = extract(intent);
        if (s == null) return;
        PluginHandle h = getBridge() == null ? null : getBridge().getPlugin("ShareIntent");
        if (h != null && h.getInstance() instanceof ShareIntentPlugin) {
            ((ShareIntentPlugin) h.getInstance()).emit(s);
        } else {
            ShareIntentPlugin.setPending(s);
        }
    }

    private ShareIntentPlugin.Shared extract(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return null;
        String text = textOf(intent);
        String image = null;
        String file = null, fileName = null, error = null;
        String type = intent.getType();
        Uri uri;
        if (Build.VERSION.SDK_INT >= 33) uri = intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
        else uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        if (type != null && uri != null) {
            if (type.startsWith("image/")) {
                image = encode(uri);
            } else if (type.equals("application/pdf") || type.startsWith("audio/")) {
                fileName = displayName(uri);
                try {
                    file = readAll(uri);
                    if (file == null) error = "too big to share into Board (over 15 MB)";
                } catch (Exception e) {
                    error = "could not be read";
                }
            }
        }
        intent.setAction(Intent.ACTION_MAIN); // don't re-save on rotation/recreate
        if (text == null && image == null && file == null && error == null) return null;
        return new ShareIntentPlugin.Shared(text, image, file, file == null ? null : type, fileName, error);
    }

    private static final int MAX_FILE = 15 * 1024 * 1024;

    /** The whole file as base64, or null when it is over MAX_FILE. */
    private String readAll(Uri uri) throws Exception {
        try (InputStream in = getContentResolver().openInputStream(uri)) {
            if (in == null) throw new Exception("no stream");
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] chunk = new byte[64 * 1024];
            int n;
            while ((n = in.read(chunk)) > 0) {
                buf.write(chunk, 0, n);
                if (buf.size() > MAX_FILE) return null;
            }
            return Base64.encodeToString(buf.toByteArray(), Base64.NO_WRAP);
        }
    }

    private String displayName(Uri uri) {
        try (Cursor c = getContentResolver().query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst()) return c.getString(0);
        } catch (Exception ignored) {}
        String last = uri.getLastPathSegment();
        return last == null ? null : last.substring(last.lastIndexOf('/') + 1);
    }

    private static String textOf(Intent intent) {
        String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
        CharSequence body = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        String s = subject == null ? "" : subject.trim();
        String b = body == null ? "" : body.toString().trim();
        if (b.isEmpty()) return s.isEmpty() ? null : s;
        if (s.isEmpty() || b.contains(s)) return b;
        return s + "\n" + b;
    }

    /** Decode with subsampling, fix rotation, scale to ≤1600px, JPEG 82%, base64. */
    private String encode(Uri uri) {
        try {
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            try (InputStream in = getContentResolver().openInputStream(uri)) { BitmapFactory.decodeStream(in, null, bounds); }
            int sample = 1;
            while (Math.max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= MAX_SIDE) sample *= 2;
            BitmapFactory.Options opts = new BitmapFactory.Options();
            opts.inSampleSize = sample;
            Bitmap bmp;
            try (InputStream in = getContentResolver().openInputStream(uri)) { bmp = BitmapFactory.decodeStream(in, null, opts); }
            if (bmp == null) return null;

            int rotate = 0;
            try (InputStream in = getContentResolver().openInputStream(uri)) {
                int o = new ExifInterface(in).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
                if (o == ExifInterface.ORIENTATION_ROTATE_90) rotate = 90;
                else if (o == ExifInterface.ORIENTATION_ROTATE_180) rotate = 180;
                else if (o == ExifInterface.ORIENTATION_ROTATE_270) rotate = 270;
            } catch (Exception ignored) {}

            float scale = Math.min(1f, (float) MAX_SIDE / Math.max(bmp.getWidth(), bmp.getHeight()));
            Matrix m = new Matrix();
            m.postScale(scale, scale);
            if (rotate != 0) m.postRotate(rotate);
            Bitmap out = Bitmap.createBitmap(bmp, 0, 0, bmp.getWidth(), bmp.getHeight(), m, true);

            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            out.compress(Bitmap.CompressFormat.JPEG, 82, buf);
            return Base64.encodeToString(buf.toByteArray(), Base64.NO_WRAP);
        } catch (Exception e) {
            return null;
        }
    }
}
