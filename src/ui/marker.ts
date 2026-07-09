export default class Marker {
	private markerMap = Map<string, number[]>();
	
	addMarker(session: Ace.EditSession, range: Parameters<typeof session.addMarker>[0]): number {
		const markerId = session.addMarker(range, );
		if (this.markerMap.has(session.id)) {
			const markers = this.markerMap.get(session.id);
			markers.push(markerId);
			this.markerMap.set(session.id, markerId);
			return markerId;
		}
		this.markerMap.set(session.id, [markerId]);
		return markerId;
	}
	clearMarker(session) {
		if (!this.markerMap.has(session.id)) return;
		const markers = this.markerMap.get(session.id);
		markers.forEach(markerId => session.removeMarker(markerId));
		this.markerMap.delete(session.id);
	}
}