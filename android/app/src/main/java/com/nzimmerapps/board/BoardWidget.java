package com.nzimmerapps.board;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

/** Home-screen widget: one tap opens Board ready to type, or straight into a voice note. */
public class BoardWidget extends AppWidgetProvider {
    static final String ACTION_QUICK = "com.nzimmerapps.board.QUICK_ADD";
    static final String EXTRA_MODE = "mode";

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.board_widget);
            views.setOnClickPendingIntent(R.id.widget_note, open(context, "note", 1));
            views.setOnClickPendingIntent(R.id.widget_voice, open(context, "voice", 2));
            manager.updateAppWidget(id, views);
        }
    }

    private static PendingIntent open(Context context, String mode, int code) {
        Intent i = new Intent(context, MainActivity.class)
            .setAction(ACTION_QUICK)
            .putExtra(EXTRA_MODE, mode)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(context, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
