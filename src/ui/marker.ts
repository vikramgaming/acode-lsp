export default class Marker {
	session: Ace.EditSession;
	markers: number[] = [];
	
	constructor(session: Ace.EditSession) {
		this.session = session;
	}
	
	addMarker(range: Parameters<typeof this.session.addMarker>[0], clazz = "ace_selection-text", type = "text", inFront = true) {
		// Mengonversi interface internal ke format Ace Range yang valid
		const AceRange = ace.require("ace/range").Range;
		const aceRange = new AceRange(range.start.row, range.start.column, range.end.row, range.end.column);

		const markerId = this.session.addMarker(aceRange, clazz, type, inFront);
		this.markers.push(markerId);
		return markerId;
	}

	deleteMarker(id: number) {
		if (!this.markers.includes(id)) return;
		
		this.session.removeMarker(id);
		// Menghapus ID dari array secara bersih
		this.markers = this.markers.filter(markerId => markerId !== id);
	}

	clearMarkers() {
		this.markers.forEach(id => this.session.removeMarker(id));
		this.markers = [];
	}
}
