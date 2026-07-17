extends Node2D

const PLAYER_START := Vector2(80.0, 190.0)
const TARGET_POSITION := Vector2(360.0, 190.0)
const PLAYER_SPEED := 220.0
const COLLECT_DISTANCE := 30.0

var player_position := PLAYER_START
var score := 0
var completed := false
var status_text := "Move with arrow keys and collect the orb."

var _score_label: Label
var _status_label: Label


func _ready() -> void:
	_score_label = Label.new()
	_score_label.position = Vector2(24.0, 20.0)
	_score_label.add_theme_font_size_override("font_size", 24)
	add_child(_score_label)

	_status_label = Label.new()
	_status_label.position = Vector2(24.0, 310.0)
	_status_label.add_theme_font_size_override("font_size", 18)
	add_child(_status_label)
	_update_labels()
	queue_redraw()


func _process(delta: float) -> void:
	if completed:
		return
	var direction := Input.get_vector("ui_left", "ui_right", "ui_up", "ui_down")
	if direction != Vector2.ZERO:
		apply_simulated_motion(direction, delta)


func apply_simulated_motion(direction: Vector2, delta: float) -> void:
	if completed or direction == Vector2.ZERO:
		return
	player_position += direction.normalized() * PLAYER_SPEED * delta
	player_position.x = clampf(player_position.x, 28.0, 612.0)
	player_position.y = clampf(player_position.y, 82.0, 284.0)
	if player_position.distance_to(TARGET_POSITION) <= COLLECT_DISTANCE:
		score = 1
		completed = true
		status_text = "Orb collected. Loop complete!"
	_update_labels()
	queue_redraw()


func get_studio_state() -> Dictionary:
	return {
		"score": score,
		"completed": completed,
		"status_text": status_text,
		"player_x": snappedf(player_position.x, 0.01),
		"player_y": snappedf(player_position.y, 0.01),
	}


func _update_labels() -> void:
	_score_label.text = "Orbs: %d / 1" % score
	_status_label.text = status_text


func _draw() -> void:
	draw_rect(Rect2(18.0, 72.0, 604.0, 224.0), Color("18223b"), true)
	draw_rect(Rect2(18.0, 72.0, 604.0, 224.0), Color("53658f"), false, 3.0)
	draw_circle(player_position, 20.0, Color("68d8ff"))
	draw_circle(player_position, 9.0, Color("d8f7ff"))
	if not completed:
		draw_circle(TARGET_POSITION, 23.0, Color("ffcb57"))
		draw_circle(TARGET_POSITION, 10.0, Color("fff0ae"))
	else:
		draw_circle(TARGET_POSITION, 27.0, Color("63e6a3"), false, 5.0)

