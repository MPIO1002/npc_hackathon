"use client";

import { useEffect, useState } from "react";
import Map from "../map/map";

export default function Schedule({ scheduleResult }: { scheduleResult?: any }) {
	const [data, setData] = useState<any | null>(scheduleResult ?? null);
	const [selectedItem, setSelectedItem] = useState<any | null>(null);
	const [mapOpen, setMapOpen] = useState(false);

	useEffect(() => {
		if (data) return;
		try {
			const raw = localStorage.getItem('ai:scheduleResult');
			if (raw) {
				setData(JSON.parse(raw));
			}
		} catch (err) {
			// ignore
		}
	}, [data]);

	const items: any[] | null =
		data?.result?.schedule?.schedule ?? data?.schedule?.schedule ?? data?.schedule ?? null;

	if (!items || items.length === 0) {
		return (
			<section className="relative bg-stone-50 py-24">
				<div className="w-full max-w-7xl mx-auto px-6 lg:px-8 overflow-x-auto">
					<div className="flex flex-col md:flex-row max-md:gap-3 items-center justify-between mb-5">
						<div className="flex items-center gap-4">
							<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
								<path d="M17 4.50001L17 5.15001L17 4.50001ZM6.99999 4.50002L6.99999 3.85002L6.99999 4.50002ZM8.05078 14.65C8.40977 14.65 8.70078 14.359 8.70078 14C8.70078 13.641 8.40977 13.35 8.05078 13.35V14.65ZM8.00078 13.35C7.6418 13.35 7.35078 13.641 7.35078 14C7.35078 14.359 7.6418 14.65 8.00078 14.65V13.35ZM8.05078 17.65C8.40977 17.65 8.70078 17.359 8.70078 17C8.70078 16.641 8.40977 16.35 8.05078 16.35V17.65ZM8.00078 16.35C7.6418 16.35 7.35078 16.641 7.35078 17C7.35078 17.359 7.6418 17.65 8.00078 17.65V16.35ZM12.0508 14.65C12.4098 14.65 12.7008 14.359 12.7008 14C12.7008 13.641 12.4098 13.35 12.0508 13.35V14.65ZM12.0008 13.35C11.6418 13.35 11.3508 13.641 11.3508 14C11.3508 14.359 11.6418 14.65 12.0008 14.65V13.35Z" fill="#111827"></path>
							</svg>
							<h6 className="text-xl leading-8 font-semibold text-gray-900">Kế hoạch chuyến đi</h6>
						</div>
					</div>
					<div className="text-gray-600">Không có dữ liệu lịch trình. Hãy tạo lịch bằng AI.</div>
				</div>
			</section>
		);
	}

	// items is an array of schedule entries
	// We'll render a single-day calendar grid (hours on the left, day column on the right)
	const hours = Array.from({ length: 12 }, (_, i) => 7 + i); // 7..18

	// helper to parse 'HH:MM' to minutes from midnight
	const parseHM = (s?: string) => {
		if (!s || typeof s !== 'string') return null;
		const m = s.match(/(\d{1,2}):(\d{2})/);
		if (!m) return null;
		const hh = parseInt(m[1], 10);
		const mm = parseInt(m[2], 10);
		return hh * 60 + mm;
	};


	// scheduling layout helpers
	const HOUR_HEIGHT_PX = 80; // matches tailwind h-20 (5rem = 80px)
	const DAY_START_HOUR = 7; // 07:00
	const DAY_END_HOUR = 19; // 19:00 (end)
	const DAY_START_MIN = DAY_START_HOUR * 60;
	const DAY_END_MIN = DAY_END_HOUR * 60;
	const minuteToPx = (m: number) => (m * HOUR_HEIGHT_PX) / 60;

	// normalize items: compute start/end minutes and filter duplicates by start minute
	const normalized: Array<any> = [];
	const seenStarts = new Set<number>();
	for (const it of items) {
		const start = parseHM(it.start_time ?? it.start ?? it.start_time ?? '');
		if (start === null) continue;
		let end = parseHM(it.end_time ?? it.end ?? it.end_time ?? '');
		if (end === null) {
			// try duration field or default to +60 minutes
			const dur = typeof it.duration_minutes === 'number' ? it.duration_minutes : (it.duration ?? null);
			if (typeof dur === 'number') end = start + dur;
			else end = start + 60;
		}
		// clamp to the visible day
		const s = Math.max(DAY_START_MIN, Math.min(DAY_END_MIN, start));
		const e = Math.max(DAY_START_MIN, Math.min(DAY_END_MIN, end));
		if (seenStarts.has(s)) continue; // temporarily drop duplicates that share the same start minute
		seenStarts.add(s);
		normalized.push({ ...it, __startMin: s, __endMin: e });
	}

	// prepare points for map from items if they include coords
	const mapPoints = (items ?? [])
		.map((it: any) => {
			const lat = it?.location?.lat ?? it?.lat ?? it?.latitude ?? it?.place?.location?.lat ?? null;
			const lng = it?.location?.lng ?? it?.lng ?? it?.longitude ?? it?.place?.location?.lng ?? null;
			if (typeof lat === 'number' && typeof lng === 'number') return { lat, lng, name: it.place_name ?? it.name ?? it.display };
			return null;
		})
		.filter(Boolean) as Array<{ lat: number; lng: number; name?: string }>;

	return (
		<section className="relative bg-stone-50 py-24">
			<div className="w-full max-w-7xl mx-auto px-6 lg:px-8 overflow-x-auto">
				<div className="flex flex-col md:flex-row max-md:gap-3 items-center justify-between mb-5">
					<div className="flex items-center gap-4">
						<h6 className="text-xl leading-8 font-semibold text-gray-900">Kế hoạch chuyến đi (Ngày)</h6>
						<button
							className="ml-4 inline-flex items-center gap-2 px-3 py-1.5 rounded bg-indigo-600 text-white text-sm hover:bg-indigo-700"
							onClick={() => setMapOpen(true)}
						>
							Xem lộ trình
						</button>
					</div>
				</div>

				<div className="relative">
					<div className="grid grid-cols-[120px_1fr_320px] border-t border-gray-200">
						{/* header row for day label */}
						<div className="p-3.5"></div>
						<div className="p-3.5 flex items-center justify-start text-sm font-medium text-gray-900">Today</div>
					</div>

					<div className="hidden sm:grid w-full grid-cols-[100px_1fr_600px]">
						{/* left column: times */}
						<div className="flex flex-col">
							{hours.map(h => (
								<div key={h} className="h-20 p-0.5 md:p-3.5 border-t border-r border-gray-200 flex items-end">
									<span className="text-xs font-semibold text-gray-400">{String(h).padStart(2, '0')}:00</span>
								</div>
							))}
						</div>

						{/* right column: day column with rows where items are placed */}
						<div className="overflow-x-auto">
							{/* relative day column sized to total hours; items absolutely positioned inside */}
							<div
								className="relative"
								style={{ height: `${(DAY_END_HOUR - DAY_START_HOUR) * HOUR_HEIGHT_PX}px` }}
							>
								{/* hour separators (visual grid) */}
								{hours.map(h => (
									<div
										key={`line-${h}`}
										className="absolute left-0 right-0 border-t border-gray-200"
										style={{ top: `${minuteToPx(h * 60 - DAY_START_MIN)}px`, height: `${HOUR_HEIGHT_PX}px` }}
									/>
								))}

								{/* schedule items placed according to computed minutes */}
								{normalized.map((it, idx) => {
									const top = minuteToPx(it.__startMin - DAY_START_MIN);
									const height = Math.max(20, minuteToPx(it.__endMin - it.__startMin));
									return (
										<div
											key={idx}
											className="absolute rounded p-2 border-l-2 border-indigo-600 bg-indigo-50 max-w-md overflow-hidden cursor-pointer focus:outline-none"
											style={{ left: '8px', right: '8px', top: `${top}px`, height: `${height}px` }}
											onClick={(e) => { e.stopPropagation(); setSelectedItem(it); }}
											onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedItem(it); } }}
											role="button"
											tabIndex={0}
										>
											<p className="text-sm font-semibold text-gray-900 truncate">{it.place_name ?? it.place?.name ?? it.name}</p>
											<p className="text-xs text-gray-600 mt-1">{(it.start_time ?? it.start ?? '')}{it.end_time || it.end ? ` - ${it.end_time ?? it.end ?? ''}` : ''}</p>
										</div>
									);
								})}
							</div>
						</div>

						{/* details column (desktop): shows selected item info in the empty right space */}
						<div className="px-4 py-6 border-l border-gray-200 bg-stone-50">
							<div className="sticky top-6">
								{selectedItem ? (
									<div>
										<h3 className="text-lg font-semibold mb-2">{selectedItem.place_name ?? selectedItem.place?.name ?? selectedItem.name}</h3>
										<div className="text-sm text-gray-600 mb-3">{selectedItem.address ?? selectedItem.place?.address ?? ''}</div>
										<div className="flex gap-4 mb-3 text-sm">
											<div><strong>Thời gian:</strong> {selectedItem.start_time ?? selectedItem.start ?? ''}{selectedItem.end_time || selectedItem.end ? ` - ${selectedItem.end_time ?? selectedItem.end ?? ''}` : ''}</div>
											<div><strong>Thời lượng:</strong> {selectedItem.duration_minutes ?? selectedItem.duration ?? '—'} phút</div>
											{selectedItem.travel_time_to_next !== undefined && <div><strong>Di chuyển tới tiếp:</strong> {selectedItem.travel_time_to_next} phút</div>}
										</div>
										{selectedItem.notes && (
											<div className="mb-3 text-sm text-gray-700">
												<strong>Ghi chú:</strong>
												<p className="mt-1">{selectedItem.notes}</p>
											</div>
										)}
										{Array.isArray(selectedItem.recommended_activities) && selectedItem.recommended_activities.length > 0 && (
											<div className="mb-3 text-sm">
												<strong>Hoạt động gợi ý:</strong>
												<ul className="list-disc list-inside mt-1 text-gray-700">
													{selectedItem.recommended_activities.map((a: string, i: number) => <li key={i}>{a}</li>)}
												</ul>
											</div>
										)}
									</div>
								) : (
									<div className="text-sm text-gray-500">Chọn một mục lịch để xem chi tiết ở đây.</div>
								)}
							</div>
						</div>
					</div>

					{/* mobile stacked view */}
					<div className="sm:hidden">
						<div className="flex flex-col gap-3">
							{items.map((it: any, idx: number) => (
								<div
									key={idx}
									className="p-3 bg-white rounded shadow-sm border cursor-pointer"
									onClick={() => setSelectedItem(it)}
									onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedItem(it); } }}
									role="button"
									tabIndex={0}
								>
									<div className="flex justify-between">
										<div className="text-sm font-semibold">{it.place_name ?? it.place?.name ?? it.name}</div>
										<div className="text-xs text-gray-500">{it.start_time ?? it.start ?? ''}{it.end_time || it.end ? ` - ${it.end_time ?? it.end ?? ''}` : ''}</div>
									</div>
								</div>
							))}
						</div>
					</div>
				</div>
			</div>

			{/* Map modal (overlay) */}
			{mapOpen && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
					<div className="w-full max-w-4xl bg-white rounded shadow-lg overflow-hidden">
						<div className="flex items-center justify-between p-4 border-b">
							<div className="font-semibold">Lộ trình</div>
							<button className="text-sm text-gray-600" onClick={() => setMapOpen(false)}>Đóng</button>
						</div>
						<div className="p-4">
							<Map points={mapPoints} />
						</div>
					</div>
				</div>
			)}
		</section>
	);
}

