import { TicketSender, TicketStatus, type Ticket, type TicketMessage, type User } from "@prisma/client";
import { prisma } from "../../lib/prisma";

export type TicketWithMessages = Ticket & { messages: TicketMessage[] };
export type TicketWithUser = Ticket & { user: User; messages: TicketMessage[] };

export class TicketService {
  async getOpenTicket(userId: number): Promise<TicketWithMessages | null> {
    return prisma.ticket.findFirst({
      where: { userId, status: TicketStatus.OPEN },
      include: { messages: { orderBy: { createdAt: "asc" } } },
      orderBy: { createdAt: "desc" },
    });
  }

  async listByStatus(status: TicketStatus, take = 30): Promise<TicketWithUser[]> {
    return prisma.ticket.findMany({
      where: { status },
      include: {
        user: true,
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: { updatedAt: "desc" },
      take,
    });
  }

  async getTicketCounts(): Promise<{ open: number; closed: number }> {
    const [open, closed] = await Promise.all([
      prisma.ticket.count({ where: { status: TicketStatus.OPEN } }),
      prisma.ticket.count({ where: { status: TicketStatus.CLOSED } }),
    ]);
    return { open, closed };
  }

  async getById(ticketId: number): Promise<TicketWithMessages | null> {
    return prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        messages: { orderBy: { createdAt: "asc" } },
      },
    });
  }

  async getByIdWithUser(ticketId: number): Promise<TicketWithUser | null> {
    return prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        user: true,
        messages: { orderBy: { createdAt: "asc" } },
      },
    });
  }

  async createUserMessage(userId: number, text: string): Promise<TicketWithMessages> {
    const existing = await this.getOpenTicket(userId);
    if (existing) {
      await prisma.ticketMessage.create({
        data: {
          ticketId: existing.id,
          sender: TicketSender.USER,
          text: text.trim(),
        },
      });
      await prisma.ticket.update({
        where: { id: existing.id },
        data: { updatedAt: new Date() },
      });
      return (await this.getById(existing.id))!;
    }

    return prisma.ticket.create({
      data: {
        userId,
        status: TicketStatus.OPEN,
        subject: text.trim().slice(0, 80),
        messages: {
          create: {
            sender: TicketSender.USER,
            text: text.trim(),
          },
        },
      },
      include: { messages: true },
    });
  }

  async createAdminReply(
    ticketId: number,
    adminTelegramId: bigint,
    text: string,
  ): Promise<TicketWithMessages> {
    await prisma.ticketMessage.create({
      data: {
        ticketId,
        sender: TicketSender.ADMIN,
        adminTelegramId,
        text: text.trim(),
      },
    });
    await prisma.ticket.update({
      where: { id: ticketId },
      data: { updatedAt: new Date(), status: TicketStatus.OPEN },
    });
    return (await this.getById(ticketId))!;
  }

  async closeTicket(ticketId: number): Promise<TicketWithUser> {
    return prisma.ticket.update({
      where: { id: ticketId },
      data: { status: TicketStatus.CLOSED },
      include: {
        user: true,
        messages: { orderBy: { createdAt: "asc" } },
      },
    });
  }

  formatThread(ticket: TicketWithMessages, maxMessages = 12): string {
    const msgs = ticket.messages.slice(-maxMessages);
    if (msgs.length === 0) return "_پیامی ثبت نشده_";

    return msgs
      .map((m) => {
        const who = m.sender === TicketSender.ADMIN ? "🛠 ادمین" : "👤 کاربر";
        return `${who}:\n${m.text}`;
      })
      .join("\n\n");
  }

  async setGroupMessageId(ticketMessageId: number, tgMessageId: number): Promise<TicketMessage> {
    return prisma.ticketMessage.update({
      where: { id: ticketMessageId },
      data: { tgMessageId },
    });
  }

  async findOpenByGroupMessageId(tgMessageId: number): Promise<{
    ticket: Ticket;
    message: TicketMessage;
    user: User;
  } | null> {
    const message = await prisma.ticketMessage.findFirst({
      where: {
        tgMessageId,
        ticket: { status: TicketStatus.OPEN },
      },
      include: {
        ticket: {
          include: { user: true },
        },
      },
    });

    if (!message) return null;
    return {
      ticket: message.ticket,
      message,
      user: message.ticket.user,
    };
  }
}

export const ticketService = new TicketService();
