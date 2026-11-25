import mongoose from "mongoose";

const ticketSchema = new mongoose.Schema({
  ticketId: { type: String, unique: true, required: true },
  subject: { type: String, required: true },
  description: { type: String, required: true },
  priority: { type: String, enum: ["low", "medium", "high", "urgent"], default: "medium" },
  status: { type: String, enum: ["open", "in_progress", "resolved", "closed"], default: "open" },
  operatorId: { type: String, required: true, index: true },
  operatorName: { type: String, required: true },
}, { timestamps: true });

const counterSchema = new mongoose.Schema({
  seq: { type: Number, default: 0 },
});

export const Ticket = mongoose.model("Ticket", ticketSchema);
export const Counter = mongoose.model("Counter", counterSchema);