extends SceneTree


func _initialize() -> void:
	call_deferred("_run_scenario")


func _run_scenario() -> void:
	var report_path := _argument_value("--report=")
	var packed := load("res://scenes/main.tscn") as PackedScene
	if packed == null:
		_finish(report_path, {"passed": false, "failure": "main scene did not load"}, 2)
		return

	var game := packed.instantiate()
	root.add_child(game)
	await process_frame
	var initial: Dictionary = game.get_studio_state()
	for _step in range(20):
		game.apply_simulated_motion(Vector2.RIGHT, 0.1)
	var final: Dictionary = game.get_studio_state()
	var passed := (
		initial.score == 0
		and initial.completed == false
		and final.score == 1
		and final.completed == true
		and final.status_text == "Orb collected. Loop complete!"
	)
	_finish(report_path, {
		"passed": passed,
		"scenario": "move right and collect exactly one orb",
		"initial": initial,
		"final": final,
	}, 0 if passed else 3)


func _argument_value(prefix: String) -> String:
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with(prefix):
			return argument.trim_prefix(prefix)
	return ""


func _finish(report_path: String, result: Dictionary, exit_code: int) -> void:
	var serialized := JSON.stringify(result)
	print("STUDIO_SCENARIO_RESULT " + serialized)
	if not report_path.is_empty():
		var file := FileAccess.open(report_path, FileAccess.WRITE)
		if file == null:
			print("STUDIO_SCENARIO_REPORT_WRITE_FAILED " + report_path)
			quit(4)
			return
		file.store_string(serialized)
		file.close()
	quit(exit_code)

