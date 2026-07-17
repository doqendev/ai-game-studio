@tool
extends Node

func run_external_tool() -> void:
	OS.execute("fixture-tool", [])
