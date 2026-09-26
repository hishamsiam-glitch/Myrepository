package com.hishamsiam.appguard

import android.app.Activity
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.BaseAdapter
import android.widget.CheckBox
import android.widget.EditText
import android.widget.ImageView
import android.widget.ListView
import android.widget.TextView

/** Lets the administrator mark apps that are always allowed (no approval needed). */
class AppPickerActivity : Activity() {

    private lateinit var store: Store
    private var all: List<Apps.Entry> = emptyList()
    private var shown: List<Apps.Entry> = emptyList()
    private val selected = HashSet<String>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_app_picker)
        store = Store.get(this)
        selected.addAll(store.alwaysAllowedPackages)
        all = Apps.launchable(this).filter { it.pkg != packageName }
        shown = all
        val list = findViewById<ListView>(R.id.list)
        list.adapter = adapter
        list.setOnItemClickListener { _, _, pos, _ ->
            val p = shown[pos].pkg
            if (!selected.remove(p)) selected.add(p)
            store.alwaysAllowedPackages = selected
            adapter.notifyDataSetChanged()
        }
        findViewById<EditText>(R.id.search).addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun afterTextChanged(s: Editable?) {
                val q = s?.toString()?.trim()?.lowercase() ?: ""
                shown = if (q.isEmpty()) all else all.filter { it.label.lowercase().contains(q) || it.pkg.lowercase().contains(q) }
                adapter.notifyDataSetChanged()
            }
        })
    }

    private val adapter = object : BaseAdapter() {
        override fun getCount() = shown.size
        override fun getItem(position: Int) = shown[position]
        override fun getItemId(position: Int) = position.toLong()
        override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
            val v = convertView ?: LayoutInflater.from(parent.context).inflate(R.layout.item_app, parent, false)
            val e = shown[position]
            v.findViewById<ImageView>(R.id.appIcon).setImageDrawable(Apps.icon(parent.context, e.pkg))
            v.findViewById<TextView>(R.id.appLabel).text = e.label
            v.findViewById<TextView>(R.id.appPackage).text = e.pkg
            v.findViewById<CheckBox>(R.id.appCheck).isChecked = selected.contains(e.pkg)
            return v
        }
    }
}
