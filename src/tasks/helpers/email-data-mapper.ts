import { Task } from '../entities/task.entity';
import { SubTask } from '../entities/subtask.entity';
import { TaskFlag } from '../entities/task-flag.entity';
import { User } from '../../user/entities/user.entity';
import { Client } from '../../clients/entities/client.entity';
import { TaskEmailData, TaskCompletedEmailData, TaskFlagEmailData, TaskFeedbackEmailData } from '../../lib/types/email-templates.types';

export class TaskEmailDataMapper {
  
  /**
   * Map data for new task emails
   */
  static mapNewTaskData(task: Task, assignee: User): TaskEmailData {
    return {
      // Base data matching template variables
      name: assignee.name || assignee.username || 'Team Member',
      assigneeName: assignee.name || assignee.username || 'Team Member',
      taskId: task.uid.toString(),
      title: task.title,
      taskTitle: task.title,
      description: task.description || 'No description provided',
      taskDescription: task.description || 'No description provided',
      deadline: task.deadline?.toISOString(),
      dueDate: this.formatDate(task.deadline),
      priority: task.priority,
      taskType: task.taskType,
      status: task.status,
      assignedBy: this.getCreatorName(task.creator),
      
      // Additional template variables
      appName: 'Loro',
      projectName: 'General Task', // Will be updated if clients are properly populated
      estimatedTime: 'Not specified',
      taskUrl: this.generateTaskUrl(task.uid),
      projectManager: this.getCreatorName(task.creator),
      supportEmail: process.env.SUPPORT_EMAIL || 'support@loro.com',
      
      // Data structures
      attachments: this.mapAttachments(task.attachments),
      subtasks: this.mapSubtasks(task.subtasks),
      clients: this.mapClients(task.clients),
      
      // Optional fields with fallbacks
      dependencies: [],
      successCriteria: []
    };
  }

  /**
   * Map data for task update emails
   */
  static mapUpdateTaskData(task: Task, assignee: User, updatedBy: string, changes: any[]): TaskEmailData {
    const baseData = this.mapNewTaskData(task, assignee);
    return {
      ...baseData,
      updatedBy: updatedBy,
      updateDate: this.formatDate(new Date()),
      currentStatus: task.status,
      changes: changes,
      // Additional template variables for updates
      taskCreator: this.getCreatorName(task.creator),
      taskCreatorEmail: this.getCreatorEmail(task.creator),
      projectManagerEmail: process.env.PROJECT_MANAGER_EMAIL || 'pm@loro.com',
      updatedByEmail: process.env.UPDATED_BY_EMAIL || 'admin@loro.com'
    };
  }

  /**
   * Map data for task completion emails
   */
  static mapCompletedTaskData(task: Task, client: Client, completedBy: string): TaskCompletedEmailData {
    return {
      name: client.contactPerson || client.name || 'Valued Client',
      assigneeName: client.contactPerson || client.name || 'Valued Client',
      taskId: task.uid.toString(),
      title: task.title,
      taskTitle: task.title,
      description: task.description || 'No description provided',
      taskDescription: task.description || 'No description provided',
      deadline: task.deadline?.toISOString(),
      dueDate: this.formatDate(task.deadline),
      priority: task.priority,
      taskType: task.taskType,
      status: task.status,
      assignedBy: this.getCreatorName(task.creator),
      completionDate: this.formatDate(task.completionDate),
      completedBy: completedBy,
      feedbackLink: this.generateFeedbackUrl(task.uid, client.uid),
      jobCards: this.mapJobCards(task.attachments),
      subtasks: this.mapSubtasks(task.subtasks),
      clients: this.mapClients(task.clients),
      attachments: this.mapAttachments(task.attachments),
      
      // Additional completion template variables
      projectName: client.name || 'Client Project',
      timeTaken: this.calculateTimeTaken(task),
      completionStatus: 'Successfully Completed',
      taskUrl: this.generateTaskUrl(task.uid),
      completionNotes: '',
      deliverables: this.mapDeliverables(task.attachments)
    };
  }

  /**
   * Map data for assignee task completion emails (internal notifications)
   */
  static mapAssigneeCompletionData(task: Task, assignee: User, completedBy: string): TaskCompletedEmailData {
    return {
      name: assignee.name || assignee.username || 'Team Member',
      assigneeName: assignee.name || assignee.username || 'Team Member',
      taskId: task.uid.toString(),
      title: task.title,
      taskTitle: task.title,
      description: task.description || 'No description provided',
      taskDescription: task.description || 'No description provided',
      deadline: task.deadline?.toISOString(),
      dueDate: this.formatDate(task.deadline),
      priority: task.priority,
      taskType: task.taskType,
      status: task.status,
      assignedBy: this.getCreatorName(task.creator),
      completionDate: this.formatDate(task.completionDate),
      completedBy: completedBy,
      feedbackLink: '',
      jobCards: this.mapJobCards(task.attachments),
      subtasks: this.mapSubtasks(task.subtasks),
      clients: this.mapClients(task.clients),
      attachments: this.mapAttachments(task.attachments),
      
      // Additional completion template variables
      projectName: 'General Task', // Will be updated if clients are properly populated
      timeTaken: this.calculateTimeTaken(task),
      completionStatus: 'Successfully Completed',
      taskUrl: this.generateTaskUrl(task.uid),
      completionNotes: '',
      deliverables: this.mapDeliverables(task.attachments)
    };
  }

  /**
   * Map data for task reminder emails (assignee)
   */
  static mapTaskReminderAssigneeData(task: Task, assignee: User): any {
    const now = new Date();
    const deadline = task.deadline ? new Date(task.deadline) : null;
    const isOverdue = deadline ? deadline < now : false;
    const daysDifference = deadline ? Math.ceil(Math.abs((deadline.getTime() - now.getTime()) / (1000 * 3600 * 24))) : 0;

    return {
      name: assignee.name || assignee.username || 'Team Member',
      assigneeName: assignee.name || assignee.username || 'Team Member',
      taskTitle: task.title,
      taskDescription: task.description || 'No description provided',
      projectName: this.getProjectName(task.clients),
      dueDate: this.formatDate(task.deadline),
      priority: task.priority,
      taskStatus: task.status,
      isOverdue: isOverdue,
      daysDifference: daysDifference,
      taskUrl: this.generateTaskUrl(task.uid),
      taskCreator: this.getCreatorName(task.creator),
      projectManager: this.getCreatorName(task.creator),
      supportEmail: process.env.SUPPORT_EMAIL || 'support@loro.com'
    };
  }

  /**
   * Map data for task reminder emails (creator)
   */
  static mapTaskReminderCreatorData(task: Task, creator: User, assignees: User[]): any {
    const now = new Date();
    const deadline = task.deadline ? new Date(task.deadline) : null;
    const isOverdue = deadline ? deadline < now : false;
    const daysDifference = deadline ? Math.ceil(Math.abs((deadline.getTime() - now.getTime()) / (1000 * 3600 * 24))) : 0;

    return {
      name: creator.name || creator.username || 'Team Member',
      creatorName: creator.name || creator.username || 'Team Member',
      taskTitle: task.title,
      taskDescription: task.description || 'No description provided',
      assigneeName: assignees.map(a => a.name || a.username).join(', '),
      projectName: this.getProjectName(task.clients),
      dueDate: this.formatDate(task.deadline),
      priority: task.priority,
      taskStatus: task.status,
      isOverdue: isOverdue,
      daysDifference: daysDifference,
      taskUrl: this.generateTaskUrl(task.uid),
      lastUpdate: task.updatedAt ? {
        date: this.formatDate(task.updatedAt),
        by: 'System',
        notes: 'Last system update'
      } : null,
      assigneeEmail: assignees.length > 0 ? assignees[0].email : '',
      supportEmail: process.env.SUPPORT_EMAIL || 'support@loro.com',
      appName: 'Loro'
    };
  }

  /**
   * Map data for task flag emails
   */
  static mapTaskFlagData(taskFlag: TaskFlag, task: Task, user: User, recipientName: string = 'Team Member'): TaskFlagEmailData {
    const flaggedByName = `${user.name || ''} ${user.surname || ''}`.trim() || user.username || 'System';
    
    return {
      name: recipientName,
      assigneeName: recipientName,
      taskId: task.uid,
      taskTitle: task.title,
      flagId: taskFlag.uid,
      flagTitle: taskFlag.title,
      flagDescription: taskFlag.description || 'No description provided',
      flagStatus: taskFlag.status,
      flagDeadline: taskFlag.deadline?.toISOString(),
      createdBy: {
        name: flaggedByName,
        email: user.email || ''
      },
      items: taskFlag.items?.map(item => ({
        title: item.title,
        description: item.description || '',
        status: item.status
      })) || [],
      attachments: taskFlag.attachments || [],
      comments: this.transformCommentsForEmail(taskFlag.comments || []),
      
      // Additional template fields
      flaggedBy: flaggedByName,
      flaggedByEmail: user.email || '',
      flagDate: this.formatDate(taskFlag.createdAt),
      flagPriority: 'medium', // Default priority, should be dynamic based on flag data
      flagType: 'Quality Control',
      flagCategory: 'quality',
      projectName: this.getProjectName(task.clients),
      taskUrl: this.generateTaskUrl(task.uid),
      suggestedActions: [
        'Review the flagged concern thoroughly',
        'Contact the flag creator for clarification',
        'Create a resolution action plan',
        'Implement necessary improvements'
      ],
      impactLevel: 'medium',
      deadline: this.formatDate(taskFlag.deadline),
      projectManager: this.getCreatorName(task.creator),
      projectManagerEmail: this.getCreatorEmail(task.creator),
      teamLead: this.getCreatorName(task.creator),
      teamLeadEmail: this.getCreatorEmail(task.creator),
      supportEmail: process.env.SUPPORT_EMAIL || 'support@loro.com',
      escalationPath: [
        'Contact the project manager',
        'Escalate to team lead',
        'Involve senior management if needed'
      ]
    };
  }

  /**
   * Map data for task feedback emails
   */
  static mapTaskFeedbackData(
    taskId: number, 
    taskTitle: string, 
    feedbackContent: string, 
    submittedBy: User, 
    recipientName: string = 'Team Member',
    task?: Task,
    rating?: number
  ): TaskFeedbackEmailData {
    const feedbackByName = `${submittedBy.name || ''} ${submittedBy.surname || ''}`.trim() || submittedBy.username || 'System';
    
    return {
      name: recipientName,
      assigneeName: recipientName,
      taskId: taskId,
      taskTitle: taskTitle,
      feedbackContent: feedbackContent,
      rating: rating,
      submittedBy: {
        name: feedbackByName,
        email: submittedBy.email || ''
      },
      submittedAt: new Date().toISOString(),
      
      // Additional template fields
      feedbackBy: feedbackByName,
      feedbackByEmail: submittedBy.email || '',
      feedbackDate: this.formatDate(new Date()),
      projectName: task ? this.getProjectName(task.clients) : 'General Task',
      taskStatus: task ? task.status : 'In Progress',
      taskUrl: this.generateTaskUrl(taskId),
      feedbackSummary: feedbackContent.length > 200 ? feedbackContent.substring(0, 200) + '...' : feedbackContent,
      positivePoints: [
        'Task completion within deadline',
        'Quality of work meets standards',
        'Good communication during execution'
      ],
      improvementAreas: [
        'Documentation could be more detailed',
        'Consider more frequent progress updates'
      ],
      actionItems: [
        'Implement suggested improvements',
        'Apply learnings to future tasks',
        'Schedule follow-up review'
      ],
      feedbackType: 'Performance Review',
      qualityScore: rating ? Math.min(rating * 2, 10) : undefined,
      timeliness: 'On time',
      communication: 'Good',
      projectManager: task ? this.getCreatorName(task.creator) : 'Project Manager',
      projectManagerEmail: task ? this.getCreatorEmail(task.creator) : 'pm@loro.com',
      hrContact: 'HR Team',
      hrEmail: process.env.HR_EMAIL || 'hr@loro.com',
      supportEmail: process.env.SUPPORT_EMAIL || 'support@loro.com',
      nextReviewDate: this.formatDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)) // 30 days from now
    };
  }

  /**
   * Track changes between original and updated task
   */
  static trackTaskChanges(original: Task, updates: any): Array<{field: string, oldValue: string, newValue: string}> {
    const changes = [];
    
    if (updates.title && updates.title !== original.title) {
      changes.push({
        field: 'Title', 
        oldValue: original.title, 
        newValue: updates.title
      });
    }
    
    if (updates.deadline && new Date(updates.deadline).getTime() !== original.deadline?.getTime()) {
      changes.push({
        field: 'Due Date', 
        oldValue: this.formatDate(original.deadline), 
        newValue: this.formatDate(new Date(updates.deadline))
      });
    }
    
    if (updates.priority && updates.priority !== original.priority) {
      changes.push({
        field: 'Priority', 
        oldValue: original.priority, 
        newValue: updates.priority
      });
    }
    
    if (updates.status && updates.status !== original.status) {
      changes.push({
        field: 'Status', 
        oldValue: original.status, 
        newValue: updates.status
      });
    }

    if (updates.description && updates.description !== original.description) {
      changes.push({
        field: 'Description', 
        oldValue: original.description || 'No description', 
        newValue: updates.description
      });
    }
    
    return changes;
  }

  /**
   * Utility Methods
   */
  private static formatDate(date?: Date): string {
    if (!date) return 'Not specified';
    return new Date(date).toLocaleDateString('en-ZA', {
      weekday: 'long',
      year: 'numeric', 
      month: 'long',
      day: 'numeric'
    });
  }

  private static getCreatorName(creator: any): string {
    if (!creator) return 'System';
    
    // Handle array format
    if (Array.isArray(creator) && creator[0]) {
      const user = creator[0];
      return `${user.name || ''} ${user.surname || ''}`.trim() || user.username || 'System';
    }
    
    // Handle single object format
    return `${creator.name || ''} ${creator.surname || ''}`.trim() || creator.username || 'System';
  }

  private static getCreatorEmail(creator: any): string {
    if (!creator) return '';
    
    // Handle array format
    if (Array.isArray(creator) && creator[0]) {
      const user = creator[0];
      return user.email || '';
    }
    
    // Handle single object format
    return creator.email || '';
  }

  private static getProjectName(clients?: any[]): string {
    if (!clients || !Array.isArray(clients) || clients.length === 0) {
      return 'General Task';
    }
    
    // If there's a client, use the client name as project name
    const primaryClient = clients[0];
    return primaryClient.name || 'Client Project';
  }

  private static generateTaskUrl(taskId: number): string {
    const baseUrl = process.env.APP_URL || process.env.FRONTEND_URL || 'https://app.loro.com';
    return `${baseUrl}/tasks/${taskId}`;
  }

  private static generateFeedbackUrl(taskId: number, clientId: number): string {
    const baseUrl = process.env.APP_URL || process.env.FRONTEND_URL || 'https://app.loro.com';
    const token = Buffer.from(`${clientId}-${taskId}-${Date.now()}`).toString('base64');
    return `${baseUrl}/feedback?token=${token}&type=TASK`;
  }

  private static calculateTimeTaken(task: Task): string {
    if (!task.jobStartTime || !task.completionDate) {
      // Fallback: try to calculate from created date if job times aren't available
      if (task.createdAt && task.completionDate) {
        const startTime = new Date(task.createdAt).getTime();
        const endTime = new Date(task.completionDate).getTime();
        const diffMs = endTime - startTime;
        
        const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        
        if (days > 0) {
          return `${days} day${days > 1 ? 's' : ''} ${hours}h`;
        }
        return `${hours} hours`;
      }
      return 'Not tracked';
    }
    
    const startTime = new Date(task.jobStartTime).getTime();
    const endTime = new Date(task.completionDate).getTime();
    const diffMs = endTime - startTime;
    
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes} minutes`;
  }

  private static mapAttachments(attachments?: string[]): Array<{name: string, url: string}> {
    if (!attachments || !Array.isArray(attachments)) return [];
    
    return attachments.map((url, index) => ({
      name: `Attachment ${index + 1}`,
      url: url
    }));
  }

  private static mapJobCards(attachments?: string[]): Array<{name: string, url: string}> {
    if (!attachments || !Array.isArray(attachments)) return [];
    
    return attachments.map((url, index) => ({
      name: `Job Card ${index + 1}`,
      url: url
    }));
  }

  private static mapSubtasks(subtasks?: SubTask[]): Array<{title: string, status: string, description: string}> {
    if (!subtasks || !Array.isArray(subtasks)) return [];
    
    return subtasks
      .filter(st => !st.isDeleted)
      .map(st => ({
        title: st.title,
        status: st.status,
        description: st.description || ''
      }));
  }

  private static transformCommentsForEmail(comments: any[]): Array<{
    content: string;
    createdAt: string;
    createdBy: { name: string };
  }> {
    if (!comments || !Array.isArray(comments)) return [];
    
    return comments.map(comment => ({
      content: comment.content || '',
      createdAt: comment.createdAt instanceof Date 
        ? comment.createdAt.toISOString()
        : typeof comment.createdAt === 'string' 
        ? comment.createdAt 
        : new Date().toISOString(),
      createdBy: {
        name: comment.createdBy?.name || 'Unknown User'
      }
    }));
  }

  /**
   * Map clients for templates
   */
  private static mapClients(clients?: any[]): Array<{name: string, category?: string}> {
    if (!clients || !Array.isArray(clients)) return [];
    
    return clients.map(client => ({
      name: client.name || 'Unnamed Client',
      category: client.category || client.type || 'Standard'
    }));
  }

  /**
   * Map deliverables for completion templates
   */
  private static mapDeliverables(attachments?: string[]): string[] {
    if (!attachments || !Array.isArray(attachments)) return [];
    
    return attachments.map((_, index) => `Deliverable ${index + 1}`);
  }
} 