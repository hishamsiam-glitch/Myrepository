package com.hishamsiam.appguard

import android.app.Activity
import android.app.AlertDialog
import android.view.LayoutInflater
import android.view.View
import android.widget.EditText
import android.widget.TextView

/** PIN prompts built on the framework AlertDialog. */
object PinDialog {

    /** Asks for the existing PIN; [onOk] runs only when it is correct. */
    fun verify(activity: Activity, onOk: () -> Unit) {
        val store = Store.get(activity)
        if (!store.hasPin) { create(activity, onOk); return }
        val view = LayoutInflater.from(activity).inflate(R.layout.dialog_pin, null)
        val pin = view.findViewById<EditText>(R.id.pin1)
        val err = view.findViewById<TextView>(R.id.pinError)
        val dlg = AlertDialog.Builder(activity)
            .setTitle(R.string.pin_title)
            .setView(view)
            .setPositiveButton(R.string.ok, null)
            .setNegativeButton(R.string.cancel, null)
            .create()
        dlg.setOnShowListener {
            dlg.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                if (store.checkPin(pin.text.toString())) { dlg.dismiss(); onOk() }
                else { err.visibility = View.VISIBLE; err.setText(R.string.pin_wrong); pin.text.clear() }
            }
        }
        dlg.show()
    }

    /** Creates (or replaces) the PIN. */
    fun create(activity: Activity, onDone: () -> Unit) {
        val store = Store.get(activity)
        val view = LayoutInflater.from(activity).inflate(R.layout.dialog_pin, null)
        val pin1 = view.findViewById<EditText>(R.id.pin1)
        val pin2 = view.findViewById<EditText>(R.id.pin2)
        val err = view.findViewById<TextView>(R.id.pinError)
        pin2.visibility = View.VISIBLE
        val dlg = AlertDialog.Builder(activity)
            .setTitle(R.string.pin_create_title)
            .setView(view)
            .setPositiveButton(R.string.ok, null)
            .setNegativeButton(R.string.cancel, null)
            .create()
        dlg.setOnShowListener {
            dlg.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val a = pin1.text.toString(); val b = pin2.text.toString()
                when {
                    a.length < 4 -> { err.visibility = View.VISIBLE; err.setText(R.string.pin_too_short) }
                    a != b -> { err.visibility = View.VISIBLE; err.setText(R.string.pin_mismatch) }
                    else -> { store.setPin(a); dlg.dismiss(); onDone() }
                }
            }
        }
        dlg.show()
    }
}
